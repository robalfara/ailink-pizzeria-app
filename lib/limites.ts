import "server-only";

import { createHash, randomBytes } from "node:crypto";

/**
 * Limitador de uso del chat.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ESTO NO ES LA ÚLTIMA DEFENSA. Es la primera, y es la barata.
 * ───────────────────────────────────────────────────────────────────────────
 *
 * En el sistema hay dos limitadores y hacen cosas distintas:
 *
 *  1. **Este.** En memoria del proceso de Next, delante de todo. Corta el
 *     grueso del abuso sin pagar un viaje a la base de datos y protege al
 *     propio proceso: lo que se rechaza aquí no abre conexión, no despierta a
 *     n8n y no gasta un token. Es un limitador de RITMO.
 *  2. **El backstop en Postgres** (migración `0004_limites.sql`), al que n8n
 *     llama antes de gastar un token: contador global y presupuesto diario en
 *     dólares, persistente y compartido. Ese es el AUTORITATIVO, y es el único
 *     que acota el GASTO.
 *
 * La diferencia no es una sutileza. Un limitador en memoria **no puede** acotar
 * una factura: se reinicia en cada despliegue, no se comparte entre réplicas
 * —con N réplicas el tope real es N × tope— y no sabe lo que cuesta un mensaje.
 * Un limitador en memoria que se cree la última defensa es exactamente como se
 * llega a una factura sorpresa. Por eso los números de más abajo llevan escrito
 * cuánto se puede quemar en el peor caso ATRAVESANDO esta capa: ese número es
 * el argumento de por qué el presupuesto diario del backstop no es opcional.
 *
 * ## El relevo
 *
 * El día que haya más de una réplica —o cuando el backstop absorba también el
 * ritmo— esto se sustituye por Redis o por la propia base. La sustitución es
 * local a propósito:
 *
 *  - `comprobarLimite()` es el único punto de entrada y tiene un solo
 *    consumidor, `app/api/chat/route.ts`.
 *  - Devuelve un `Veredicto` plano: ni Response, ni cabeceras, ni copy. Quien
 *    llama decide qué contestar.
 *  - No hay estado del limitador fuera de este fichero, y nadie de fuera lo
 *    lee. Cambiar el almacén es cambiar este fichero y nada más.
 *  - Una implementación sobre Redis devolvería `Promise<Veredicto>`: el cambio
 *    en el consumidor es añadir un `await`. Esa es toda la deuda.
 */

// ---------------------------------------------------------------------------
// Los números
// ---------------------------------------------------------------------------

/**
 * Ventana y tope POR CLIENTE: 20 mensajes cada 5 minutos.
 *
 * Vienen de antes y se mantienen. Una conversación real con Nina son 4-8
 * mensajes («¿tenéis sin gluten?», «¿a qué hora cerráis?», «mesa para cuatro
 * el sábado»). 20 en cinco minutos es más del doble de la conversación más
 * larga que se ha visto: quien pasa de ahí ya no está preguntando por la
 * carta.
 */
const VENTANA_MS = 5 * 60_000;
const MAXIMO_POR_CLIENTE = 20;

type Techo = { cubo: Cubo; ventanaMs: number; tope: number };

/**
 * Techo GLOBAL del proceso. Dos ventanas, y hacen falta las dos.
 *
 * Sin un tope agregado, los cubos por cliente no acotan nada: la clave de un
 * anónimo es su IP, la IP sale de `x-forwarded-for`, y esa cabecera es una
 * cadena que elige el cliente salvo que haya delante un proxy de confianza que
 * la reescriba (el supuesto está documentado en `app/api/chat/route.ts`). N IPs
 * inventadas son N × 20 mensajes. El techo es lo único de esta capa que no
 * depende de que la identidad del cliente sea de fiar.
 *
 * Los números salen de la demanda plausible de UNA pizzería de barrio, no de un
 * objetivo de coste —esta capa no puede fijar un objetivo de coste—:
 *
 *  - Una conversación viva son ~2 mensajes por minuto.
 *  - Un viernes bueno, con 6 personas chateando a la vez, ~12 msg/min.
 *  - Un día entero de esta landing, del orden de 200 mensajes.
 *
 * De ahí:
 *
 *  - **30 por minuto.** 2,5× el viernes bueno; el equivalente a 15
 *    conversaciones simultáneas. Absorbe una punta real y corta un script en
 *    seco. La ventana es de 60 s y no de 5 min a propósito: cuando este cubo
 *    salta se degrada a TODO el mundo, clientes incluidos, así que tiene que
 *    volver a abrirse rápido. Un minuto de «ahora no puedo» se aguanta; cinco
 *    minutos un sábado a las 21:00 es el chat roto.
 *  - **400 por hora.** El cubo del minuto acota la punta, no la duración: un
 *    bot que se quede en 30/min sostiene 1.800 mensajes en una hora. 400 en una
 *    hora es ya el DOBLE del tráfico esperado de un día entero, así que ningún
 *    cliente real lo ve, y deja sitio de sobra para que un solo cliente al
 *    máximo de su cubo (20 cada 5 min = 240/h) no agote él solo el techo de
 *    todos.
 *
 * Lo que queda en pie, con su número: al peor caso medido de 0,23 $ por mensaje,
 * 400 mensajes/hora son ~92 $/hora. Esta capa no es un tope de gasto y no puede
 * serlo. El tope de gasto es el presupuesto diario del backstop.
 *
 * Y el coste de la ventana larga, dicho también: si salta el cubo de la hora, el
 * chat queda degradado hasta que las marcas envejezcan, y al vivir en memoria no
 * hay manera de reabrirlo salvo reiniciando el proceso. Es deliberado —degradar
 * es la dirección segura— y es una razón más para que esto acabe en el backstop,
 * que se reabre con un UPDATE.
 */
const TECHOS_GLOBALES: readonly Techo[] = [
  { cubo: "global-minuto", ventanaMs: 60_000, tope: 30 },
  { cubo: "global-hora", ventanaMs: 60 * 60_000, tope: 400 },
];

/**
 * Cada cuánto, como mucho, se recorre el mapa entero para tirar lo muerto.
 *
 * Antes se barría en CADA llamada, y eso convertía el propio límite en el
 * ataque: el coste era O(claves vivas) por petición. Con 100.000 claves, 18,6 ms
 * de CPU **síncrona** por petición en la medición de la auditoría y 10,0 ms en
 * la de esta máquina; el orden de magnitud es el mismo. A ese ritmo el bucle de
 * eventos se queda pinneado con cien peticiones por segundo, y no solo se cae el
 * chat: se cae la web entera, porque todo lo demás encola detrás.
 */
const BARRIDO_CADA_MS = 60_000;

/** Tope de claves a partir del cual se barre más a menudo. */
const MAXIMO_CLAVES = 50_000;

/**
 * Suelo entre barridos cuando se dispara por tamaño.
 *
 * Sin este suelo la corrección no lo era: si de verdad hay más de MAXIMO_CLAVES
 * claves VIVAS —las vivas el barrido no las tira—, la condición de tamaño se
 * cumple en cada llamada y se vuelve a barrer en cada petición, que es
 * exactamente el problema que se venía a arreglar. Medido: con 100.000 claves
 * vivas, 11,0 ms por llamada, igual que antes. Con el suelo, el barrido caro se
 * paga como mucho una vez por segundo y se reparte entre todas las peticiones de
 * ese segundo.
 */
const BARRIDO_MINIMO_MS = 1_000;

/**
 * Suelo entre líneas de log del MISMO cubo.
 *
 * Cortar es funcionamiento normal, pero bajo una inundación es funcionamiento
 * normal miles de veces por segundo. Una línea por rechazo convierte el log en
 * el siguiente cuello de botella: `console.warn` escribe en stderr, y stderr es
 * **síncrono** cuando apunta a un fichero o a una TTY, que es justo lo que hay
 * en un despliegue con systemd o con `docker logs`. Con el suelo, cada cubo
 * escribe como mucho una línea cada 5 s y esa línea lleva cuántos rechazos se
 * callaron desde la anterior: se ve lo mismo y no se paga el volumen.
 */
const AVISO_CADA_MS = 5_000;

// ---------------------------------------------------------------------------
// El contrato
// ---------------------------------------------------------------------------

export type Cubo = "usuario" | "ip" | "global-minuto" | "global-hora";

/**
 * Quién pide. La clave del límite tiene que ser algo que el cliente NO elija a
 * voluntad, y de eso depende que esto sirva de algo.
 *
 * Se contaba por `sessionId`, y el de un anónimo salía de una cookie: quien no
 * mandaba cookie estrenaba identidad —y cubo nuevo— en cada petición, así que el
 * tope no le tocaba nunca. Medido en su día: 2000 peticiones sin cookie, 2000
 * aceptadas. Ahora la fija `app/api/chat/route.ts` con el id de usuario si hay
 * sesión y con la IP si no.
 *
 * Un cliente identificado cuenta SOLO en su cubo de usuario, aunque cambie de
 * IP: el cubo lo sigue a él. No se le cobra además al cubo de su IP porque en
 * una red compartida —una oficina, un móvil con CGNAT— eso castigaría a clientes
 * distintos por vecindad. El precio es que quien tenga cuenta y además escriba
 * sin sesión dispone de dos cubos (40 mensajes en vez de 20); esa suma la acota
 * el techo global, y el gasto lo acota el backstop.
 */
export type Cliente =
  | { tipo: "usuario"; id: string }
  | { tipo: "ip"; id: string };

export type Veredicto = {
  permitido: boolean;
  /** Qué cubo rechazó, o `null` si pasó. Es para el log, NO para la respuesta. */
  cubo: Cubo | null;
  /**
   * Cuota DEL CLIENTE, y solo del cliente.
   *
   * Es lo único publicable en cabeceras: su tope y lo que le queda son números
   * que él mismo puede contar, así que decírselos no le da nada que no tenga. El
   * estado de los techos globales no sale nunca de este módulo.
   */
  cuota: {
    limite: number;
    restantes: number;
    /**
     * Segundos hasta que se libere el siguiente hueco de su cubo. Una ventana
     * deslizante no tiene un instante único de reinicio, así que se informa de
     * cuándo caduca la marca más vieja. 0 si no tiene ninguna.
     */
    reinicioEnSegundos: number;
  };
  /** Segundos hasta que tenga sentido reintentar. Alimenta `Retry-After`. */
  reintentarEnSegundos: number;
};

// ---------------------------------------------------------------------------
// El reloj
// ---------------------------------------------------------------------------

/**
 * Reloj MONÓTONO, no `Date.now()`.
 *
 * `performance.now()` cuenta desde que arrancó el proceso con el reloj monótono
 * del sistema (`uv_hrtime`): no lo mueven ni NTP, ni un cambio de hora manual,
 * ni reanudar una VM desde un snapshot. `Date.now()` sí, y las dos direcciones
 * rompen cosas distintas:
 *
 *  - **Salto hacia atrás de Δ.** Todas las marcas guardadas quedan «en el
 *    futuro» respecto al nuevo ahora, así que ninguna caduca: el cubo de cada
 *    cliente se queda lleno hasta Δ, y el techo global se queda cerrado. Es
 *    una denegación de servicio que se hace uno solo, y con el cubo de la hora
 *    puede durar lo que dure el salto.
 *  - **Salto hacia delante de Δ ≥ ventana.** Todas las marcas caducan de golpe:
 *    todos los cubos se vacían a la vez y durante ese instante no hay límite.
 *
 * Ninguno de los dos es hipotético: chrony pega un salto al arrancar si el reloj
 * del host venía torcido, y un contenedor reanudado ve el salto entero de una
 * vez. Con un reloj monótono, sencillamente no existen.
 *
 * Lo que este reloj NO sirve es para decir la hora: no tiene relación con la
 * época. No pasa nada, porque de aquí solo salen duraciones en segundos.
 */
function ahoraMonotono() {
  return performance.now();
}

// ---------------------------------------------------------------------------
// El estado
// ---------------------------------------------------------------------------

/**
 * Marcas de tiempo por cliente, en orden ascendente (el reloj es monótono, así
 * que se apilan ordenadas y la marca más vieja es siempre la primera).
 *
 * ⚠️ INVARIANTE que sostiene el consumo de memoria: **una entrada de este mapa
 * solo la crea una petición ACEPTADA**. Una petición rechazada no escribe nunca
 * una clave nueva. Como aceptar exige pasar el techo global, el ritmo máximo de
 * claves nuevas es el del techo: 30 por minuto. De ahí sale una cota dura del
 * tamaño del mapa, que ya no depende del tráfico:
 *
 *     30 claves/min × (5 min de ventana + 1 min hasta el próximo barrido) = 180
 *
 * Medido: 360.000 peticiones desde 360.000 IPs distintas en una hora dejan el
 * mapa en 180 claves como máximo. Una inundación no lo hace crecer, porque a
 * partir del mensaje 30 de cada minuto no se apunta nada. El barrido de abajo
 * se queda como defensa en profundidad, para el día que estos números cambien
 * o que alguien quite el techo.
 */
const porCliente = new Map<string, number[]>();

/** Lo mismo, para los techos. Cada array está acotado por el `tope` del techo. */
const globales = new Map<Cubo, number[]>();

let ultimoBarrido = 0;

const avisos = new Map<Cubo, { ultimo: number; suprimidos: number }>();

/**
 * Sal aleatoria por proceso para seudonimizar al cliente en el log.
 *
 * Ni la IP ni el id de usuario se escriben en claro. El log tiene que contestar
 * una sola pregunta —«¿esto es un cliente pesado o son mil?»— y para eso basta
 * con un identificador estable y opaco.
 *
 *  - Recortar la IP a /24 no vale: sigue señalando a una red y las 2^32 IPv4 se
 *    prueban una a una en un rato.
 *  - Un hash SIN sal tampoco: el atacante calcula el hash de las 2^32 y tiene la
 *    tabla. Con una sal aleatoria que no sale del proceso, no hay tabla que
 *    calcular.
 *  - El id de usuario va por el mismo camino, aunque `lib/dal.ts` sí lo escriba
 *    en claro en su log. Aquel se dispara una vez cuando falla una query; este
 *    se dispara bajo inundación, miles de veces, y esas líneas acaban en
 *    cualquier agregador.
 *
 * El precio: del log no se puede sacar una IP para bloquearla. Es asumible,
 * porque bloquear es cosa del proxy y el proxy tiene la IP de verdad. Si algún
 * día hace falta correlacionar entre reinicios, la sal pasa a una variable de
 * entorno y deja de ser aleatoria; que hoy lo sea es deliberado.
 */
const SAL = randomBytes(16);

function seudonimo(cliente: Cliente) {
  return createHash("sha256")
    .update(SAL)
    .update(`${cliente.tipo}:${cliente.id}`)
    .digest("hex")
    .slice(0, 12);
}

// ---------------------------------------------------------------------------
// La mecánica
// ---------------------------------------------------------------------------

/** Marcas que siguen dentro de la ventana. Conserva el orden. */
function vivas(marcas: number[], desde: number) {
  return marcas.filter((m) => m > desde);
}

/**
 * Segundos hasta que la marca más vieja salga de la ventana, redondeando hacia
 * arriba y con suelo de 1: un `Retry-After: 0` invita a reintentar de inmediato,
 * que es justo lo que se quiere evitar.
 */
function segundosHasta(masVieja: number, ventanaMs: number, ahora: number) {
  return Math.max(1, Math.ceil((masVieja + ventanaMs - ahora) / 1000));
}

/**
 * Barrido amortizado del mapa de clientes: se tiran las claves muertas de vez en
 * cuando, no en cada petición.
 */
function barrer(ahora: number) {
  const desdeElUltimo = ahora - ultimoBarrido;

  if (
    desdeElUltimo <= BARRIDO_CADA_MS &&
    !(porCliente.size > MAXIMO_CLAVES && desdeElUltimo > BARRIDO_MINIMO_MS)
  ) {
    return;
  }

  const desde = ahora - VENTANA_MS;

  for (const [clave, marcas] of porCliente) {
    const restantes = vivas(marcas, desde);
    if (restantes.length === 0) porCliente.delete(clave);
    else porCliente.set(clave, restantes);
  }

  ultimoBarrido = ahora;
}

function avisar(
  cubo: Cubo,
  contador: number,
  tope: number,
  cliente: Cliente,
  reintentarEnSegundos: number,
  ahora: number,
) {
  const estado = avisos.get(cubo);

  if (estado && ahora - estado.ultimo < AVISO_CADA_MS) {
    estado.suprimidos += 1;
    return;
  }

  const suprimidos = estado?.suprimidos ?? 0;
  avisos.set(cubo, { ultimo: ahora, suprimidos: 0 });

  // `warn` y no `error`: cortar es lo que se le pide a esto, no un fallo. Y con
  // datos, no con una frase: si mañana sube la factura, la pregunta será «¿el
  // limitador estaba cortando?», y sin el contador no hay forma de responderla.
  console.warn("[limite] petición rechazada:", {
    cubo,
    contador,
    tope,
    cliente: seudonimo(cliente),
    reintentarEnSegundos,
    suprimidosDesdeElAviso: suprimidos,
  });
}

/**
 * ¿Puede pasar esta petición?
 *
 * Orden: primero el cubo del cliente, después los techos globales de ventana más
 * corta a más larga. Se comprueban todos ANTES de apuntar nada, y solo se apunta
 * si pasan todos: **una petición rechazada no consume cuota en ningún cubo**.
 * Dos consecuencias buscadas:
 *
 *  - Un cliente atrapado en un corte global no gasta además su cuota personal,
 *    y no sale del corte doblemente castigado.
 *  - Una inundación no crea claves nuevas (ver la invariante de `porCliente`).
 *
 * Lo que se pierde: a quien está inundando no se le carga en su propio cubo lo
 * que ya le rechazó el techo, así que se queda a la sombra del techo con todo el
 * mundo en vez de quedar cortado él solo. Es aceptable —su cubo sí se llena con
 * lo que SÍ se le acepta— y separar al abusón del resto es trabajo del proxy.
 *
 * El parámetro `ahora` existe para poder inyectar un reloj en las pruebas; la
 * aplicación nunca lo pasa.
 */
export function comprobarLimite(
  cliente: Cliente,
  ahora = ahoraMonotono(),
): Veredicto {
  barrer(ahora);

  const clave = `${cliente.tipo}:${cliente.id}`;

  // La corrección de la ventana NO puede depender de cuándo tocó el barrido: se
  // filtran siempre las marcas de esta clave, que son como mucho 20. Así el
  // coste por petición es constante y no crece con el tamaño del mapa.
  const marcas = vivas(porCliente.get(clave) ?? [], ahora - VENTANA_MS);

  const cuota = {
    limite: MAXIMO_POR_CLIENTE,
    restantes: Math.max(0, MAXIMO_POR_CLIENTE - marcas.length),
    reinicioEnSegundos:
      marcas.length === 0 ? 0 : segundosHasta(marcas[0], VENTANA_MS, ahora),
  };

  if (marcas.length >= MAXIMO_POR_CLIENTE) {
    // Se reescribe ya filtrado: si no, entre barrido y barrido una clave que
    // pega contra el tope acumularía marcas viejas que nadie limpia. Aquí es
    // seguro escribir porque la clave existe por fuerza (tiene 20 marcas): no
    // se está creando ninguna entrada nueva.
    porCliente.set(clave, marcas);

    const reintentarEnSegundos = cuota.reinicioEnSegundos;
    avisar(
      cliente.tipo,
      marcas.length,
      MAXIMO_POR_CLIENTE,
      cliente,
      reintentarEnSegundos,
      ahora,
    );

    return { permitido: false, cubo: cliente.tipo, cuota, reintentarEnSegundos };
  }

  const pendientes: number[][] = [];

  for (const techo of TECHOS_GLOBALES) {
    const suyas = vivas(globales.get(techo.cubo) ?? [], ahora - techo.ventanaMs);

    // Aquí sí se escribe siempre: son dos claves fijas, no crecen, y guardarlas
    // filtradas mantiene cada array acotado por el `tope` de su techo.
    globales.set(techo.cubo, suyas);

    if (suyas.length >= techo.tope) {
      const reintentarEnSegundos = segundosHasta(
        suyas[0],
        techo.ventanaMs,
        ahora,
      );

      avisar(
        techo.cubo,
        suyas.length,
        techo.tope,
        cliente,
        reintentarEnSegundos,
        ahora,
      );

      return {
        permitido: false,
        cubo: techo.cubo,
        // Desde el punto de vista del cliente no le queda cuota utilizable, y
        // decir 0 es además lo que impide que la respuesta delate el estado del
        // techo. Ver el comentario de las cabeceras en `app/api/chat/route.ts`.
        cuota: { ...cuota, restantes: 0 },
        reintentarEnSegundos,
      };
    }

    pendientes.push(suyas);
  }

  marcas.push(ahora);
  porCliente.set(clave, marcas);
  for (const suyas of pendientes) suyas.push(ahora);

  return {
    permitido: true,
    cubo: null,
    cuota: {
      ...cuota,
      restantes: MAXIMO_POR_CLIENTE - marcas.length,
      // Con la marca recién apuntada, si era la primera ya hay un reinicio que
      // informar.
      reinicioEnSegundos: segundosHasta(marcas[0], VENTANA_MS, ahora),
    },
    reintentarEnSegundos: 0,
  };
}

// ---------------------------------------------------------------------------
// Ventanas para el banco de pruebas
// ---------------------------------------------------------------------------
// Ninguna de las dos la usa la aplicación. Están porque un limitador que no se
// puede probar es un limitador en el que hay que creer, y de esos ya hubo uno
// (el que troceaba por `sessionId` y no limitaba a nadie).

/** Vacía todo el estado, para empezar cada caso en limpio. */
export function reiniciarLimites() {
  porCliente.clear();
  globales.clear();
  avisos.clear();
  ultimoBarrido = 0;
}

/** Tamaño del estado, para comprobar que no crece sin control. */
export function estadoDeLosLimites() {
  const porTecho: Record<string, number> = {};

  for (const techo of TECHOS_GLOBALES) {
    porTecho[techo.cubo] = globales.get(techo.cubo)?.length ?? 0;
  }

  return { clientes: porCliente.size, globales: porTecho };
}
