import { cookies } from "next/headers";
import type { NextRequest } from "next/server";

import { agenteConfigurado, preguntarAlAgente } from "@/lib/agente";
import { obtenerFichaCliente } from "@/lib/dal";
import { comprobarLimite, type Cliente, type Veredicto } from "@/lib/limites";
import { FORMATO_UUID, validarMensajeChat } from "@/lib/validacion";

/**
 * Puerta del chat: el navegador habla aquí, y solo este servidor habla con n8n.
 *
 * Podría haberse embebido el Chat Trigger de n8n en un iframe y ahorrarse todo
 * esto. Se hizo así por tres cosas que ese atajo no da:
 *
 *  1. El secreto del webhook se queda en el servidor. Con el widget de n8n, la
 *     URL del webhook está en el HTML y la puede disparar cualquiera.
 *  2. El `sessionId` lo decide el servidor (ver abajo). Es el bloque 2.11 del
 *     checklist, y el fallo número uno de los agentes en n8n.
 *  3. La ficha del cliente sale de la sesión de Supabase, no de lo que el
 *     navegador diga ser.
 *
 * Va en un Route Handler y no en una Server Action porque hace falta escribir
 * una cookie para los visitantes anónimos, y porque el widget necesita hablar
 * por fetch sin arrastrar un re-render.
 */

/** Identidad de conversación para quien no ha iniciado sesión. */
const COOKIE_CHAT = "fn_chat";
const COOKIE_MAX_EDAD = 60 * 60 * 8; // ocho horas: lo que dura un servicio

/**
 * Tope de bytes del cuerpo.
 *
 * `request.json()` bufferea y parsea ANTES de que nadie mire el límite de 1000
 * caracteres, así que un POST de 9 MB se leía entero para acabar rechazado por
 * largo. Con 4 KB sobra de largo: 1000 caracteres de un mensaje en español son
 * poco más de 1 KB, y el corte de verdad lo sigue haciendo
 * `validarMensajeChat`. Esto solo evita pagar el parseo.
 */
const MAXIMO_BYTES = 4096;

function json(cuerpo: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(cuerpo, { status, headers });
}

/**
 * Lo que se le dice al cliente cuando el límite corta, sea cual sea el cubo.
 *
 * Es el MISMO texto para un corte individual y para uno global, y eso es
 * deliberado por dos motivos. Uno, honestidad: cuando lo que salta es el techo
 * del proceso, el cliente no ha ido rápido —es la casa la que está saturada— y
 * echarle la culpa a él es mentirle. Y dos, porque un mensaje distinto para cada
 * caso convierte el endpoint en un medidor: bastaría con mandar un mensaje desde
 * una IP limpia para saber si el techo global está puesto.
 */
const MENSAJE_LIMITE =
  "Ahora mismo no puedo seguirte el ritmo, perdona. Dame un par de minutos y " +
  "seguimos, o llámanos y te atendemos al vuelo.";

/**
 * Cabeceras de cuota.
 *
 * `Retry-After` (RFC 9110 §10.2.3) es obligatoria en la práctica: un 429 sin
 * ella obliga al cliente a adivinar, y lo que adivina casi siempre es
 * «inmediatamente».
 *
 * Las `RateLimit-*` son el borrador de la IETF
 * (draft-ietf-httpapi-ratelimit-headers) en su forma de tres cabeceras, que es
 * la que entienden hoy las librerías de cliente. Se mandan también en el 200:
 * ese es justo su propósito, que un cliente educado frene antes de chocar.
 *
 * ⚠️ Solo se publican los números DEL CLIENTE. Su tope y lo que le queda son
 * cosas que él mismo puede contar, así que decírselas no le da nada nuevo. Lo
 * que no sale nunca es el estado de los techos globales: quien leyera «quedan 12
 * de 30 en este minuto» sabría exactamente cuánto tráfico hace falta para dejar
 * el chat sin servicio para todos, y a qué ritmo pasar justo por debajo. Por eso
 * un rechazo global responde `RateLimit-Remaining: 0` igual que uno individual
 * —que además es verdad: ahora mismo no tiene cuota utilizable— y el cuerpo es
 * idéntico. Lo único que difiere es la magnitud del `Retry-After`, que está
 * acotada por la ventana y no dice el tope.
 */
function cabecerasDeCuota(veredicto: Veredicto): HeadersInit {
  const cabeceras: Record<string, string> = {
    "RateLimit-Limit": String(veredicto.cuota.limite),
    "RateLimit-Remaining": String(veredicto.cuota.restantes),
    "RateLimit-Reset": String(veredicto.cuota.reinicioEnSegundos),
  };

  if (!veredicto.permitido) {
    cabeceras["Retry-After"] = String(veredicto.reintentarEnSegundos);
  }

  return cabeceras;
}

/**
 * De dónde sale la clave del límite de uso.
 *
 * ⚠️ SUPUESTO: delante de la app hay un proxy de confianza (Nginx, Traefik,
 * Cloudflare…) que REESCRIBE `x-forwarded-for` en vez de dejar pasar la que
 * mande el cliente. Sin ese proxy la cabecera es una cadena que cualquiera
 * elige, y entonces el límite por IP vuelve a ser un límite que el atacante se
 * pone a sí mismo. Si la app llegara a quedar expuesta directamente, esto tiene
 * que pasar a leer la IP del socket (o el límite tiene que mudarse al proxy).
 *
 * Cuando no hay ninguna cabecera se devuelve una clave fija: todos los
 * anónimos comparten cubo. Es deliberado: ante la duda, el límite aprieta de
 * más y no de menos.
 */
function ipDelCliente(request: NextRequest) {
  const reenviada = request.headers.get("x-forwarded-for");
  // Es una lista: "cliente, proxy1, proxy2". El primero es el de más afuera.
  const primera = reenviada?.split(",")[0]?.trim();

  return primera || request.headers.get("x-real-ip")?.trim() || "sin-ip";
}

/**
 * Rechaza los POST cross-site comparando `Origin` con el `Host` de la petición.
 *
 * Las cookies son SameSite=Lax, así que una petición desde otro sitio llega ya
 * sin sesión y el daño se queda en gastar tokens ajenos. Aun así el guard sale
 * gratis: `request.json()` se traga un cuerpo `text/plain`, que es justo el
 * content-type que un `fetch` cross-site puede mandar SIN preflight.
 *
 * Se acepta la ausencia de `Origin`: curl, un healthcheck o un navegador viejo
 * no la mandan, y esto no es la barrera de autenticación.
 *
 * ⚠️ Se compara contra `Host`, así que el proxy de delante tiene que conservar
 * la cabecera Host original (`proxy_set_header Host $host` en Nginx). Si la
 * reescribe con el nombre interno, el `Origin` público dejará de cuadrar y el
 * chat empezará a contestar 403 a todo el mundo.
 */
function origenAjeno(request: NextRequest) {
  const origin = request.headers.get("origin");

  if (!origin) return false;

  try {
    return new URL(origin).host !== request.headers.get("host");
  } catch {
    // Un `Origin` que ni siquiera es una URL no viene de un navegador honrado.
    return true;
  }
}

export async function POST(request: NextRequest) {
  if (origenAjeno(request)) {
    return json({ error: "origen_no_permitido" }, 403);
  }

  // El tamaño se mira por la cabecera, antes de tocar el cuerpo. Con
  // `Transfer-Encoding: chunked` no hay `content-length` y este guard no
  // aplica; el tope de caracteres de `validarMensajeChat` sigue detrás.
  const longitud = Number(request.headers.get("content-length"));

  if (Number.isFinite(longitud) && longitud > MAXIMO_BYTES) {
    return json({ error: "cuerpo_demasiado_grande" }, 413);
  }

  if (!agenteConfigurado()) {
    return json(
      {
        respuesta:
          "El chat no está disponible ahora mismo. Escríbenos o llámanos y te contestamos.",
        degradado: true,
      },
      503,
    );
  }

  let cuerpo: unknown;

  try {
    cuerpo = await request.json();
  } catch {
    return json({ error: "cuerpo_invalido" }, 400);
  }

  const validado = validarMensajeChat(cuerpo);

  if (!validado.ok) {
    return json({ error: "mensaje_invalido", motivo: validado.motivo }, 400);
  }

  // -------------------------------------------------------------------------
  // Quién es (bloques 2.11 y 3.2)
  // -------------------------------------------------------------------------
  // El sessionId NO se acepta del navegador. Si viniera de ahí, mandar el
  // sessionId de otro sería suficiente para leerse su conversación entera: la
  // memoria del agente está indexada por esta clave y por nada más.
  //
  //  - Con sesión: la identidad la pone Supabase, y la conversación sigue al
  //    cliente aunque cambie de pestaña o de dispositivo.
  //  - Sin sesión: una cookie httpOnly que este mismo handler emite. El
  //    navegador la lleva pero no la puede leer ni falsificar desde JS.
  const usuario = await obtenerFichaCliente();
  const cookieStore = await cookies();

  let sessionId: string;

  if (usuario) {
    sessionId = `u:${usuario.id}`;
  } else {
    const existente = cookieStore.get(COOKIE_CHAT)?.value;
    const anonimo =
      existente && FORMATO_UUID.test(existente)
        ? existente
        : crypto.randomUUID();

    if (anonimo !== existente) {
      cookieStore.set(COOKIE_CHAT, anonimo, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: COOKIE_MAX_EDAD,
      });
    }

    sessionId = `a:${anonimo}`;
  }

  // -------------------------------------------------------------------------
  // Cuánto puede gastar (bloques 13.3 y 13.4)
  // -------------------------------------------------------------------------
  // La clave del límite NO es el sessionId. El de un anónimo sale de la cookie
  // `fn_chat`, y una cookie es algo que el cliente decide no mandar: sin
  // cookie, cada petición estrenaba UUID —y cubo vacío—, así que el tope no
  // frenaba a nadie. Se comprobó: 2000 peticiones sin cookie, 2000 aceptadas;
  // las mismas 2000 con un cookie-jar cortaban limpias en la 20.
  //
  // Ahora se cuenta por algo que el cliente no elige: el id de usuario si hay
  // sesión, y si no la IP (con el supuesto del proxy que documenta
  // `ipDelCliente`). El sessionId sigue igual y sigue siendo el de siempre:
  // es la clave de la memoria del agente y de la trazabilidad, no la del gasto.
  //
  // Y por encima de los cubos individuales hay un techo global del proceso, que
  // es lo único que no depende de que la identidad del cliente sea de fiar:
  // `x-forwarded-for` es falsificable sin un proxy delante que la reescriba, y
  // sin techo, N IPs inventadas son N × 20 mensajes. Los números y su porqué
  // están en `lib/limites.ts`.
  //
  // Nada de esto es el tope de gasto. El tope de gasto es el presupuesto diario
  // del backstop en Postgres, que n8n consulta antes de gastar un token. Esta
  // capa es el filtro barato que va delante: corta el grueso sin pagar un viaje
  // a la base de datos y protege al proceso de Next.
  const cliente: Cliente = usuario
    ? { tipo: "usuario", id: usuario.id }
    : { tipo: "ip", id: ipDelCliente(request) };

  const limite = comprobarLimite(cliente);

  if (!limite.permitido) {
    // Se corta ANTES de hablar con n8n: lo que se rechaza aquí no gasta un
    // token ni despierta al workflow. Ese es el único motivo de que esta capa
    // exista delante del backstop.
    return json(
      { respuesta: MENSAJE_LIMITE, degradado: true },
      429,
      cabecerasDeCuota(limite),
    );
  }

  // El id de idempotencia se prefija con la sesión antes de salir de aquí.
  // Sin esto, adivinar el UUID de otro bastaría para que `registrar_turno` te
  // devolviera la respuesta que se le dio a esa persona.
  const mensajeId = `${sessionId}#${validado.datos.mensajeId}`;

  const { respuesta, degradado } = await preguntarAlAgente({
    texto: validado.datos.texto,
    sessionId,
    mensajeId,
    usuario,
  });

  // Siempre 200 hacia el navegador, incluso en degradado: para el widget hay
  // un mensaje que pintar y el usuario no tiene que ver una pantalla rota. El
  // fallo ya quedó registrado en el log del servidor y en agente.turnos.
  return json({ respuesta, degradado }, 200, cabecerasDeCuota(limite));
}
