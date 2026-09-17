<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# ailink-pizzeria-app

Landing de la pizzería **Forno Nostro** con área de cliente.

## Stack

- **Next.js 16.3.3** (App Router) · React 19.2.8 · TypeScript strict
- **Tailwind v4**, configuración CSS-first: el tema vive en el bloque `@theme` de
  `app/globals.css`, **no hay `tailwind.config`**
- **Supabase**: Auth (email + contraseña, con confirmación) y Postgres con RLS.
  `@supabase/ssr` 0.12.5 y `@supabase/supabase-js` 2.112.4
- **Playwright** para las pruebas de punta a punta (`tests/e2e/`). Sin tests
  unitarios y sin CI hoy

## Modo de operación
- **Claude planifica, revisa y coordina; la ejecución —edición de documentos, trabajo con scripts, fases del runner e investigación— se delega a subagentes Sonnet 5 con instrucciones completas**, y Alfredo revisa las nuevas fases del runner antes de que se ejecuten en cualquier entorno.

## Comandos

```bash
npm ci                  # instalar (no npm install: respeta el lockfile)
npm run dev             # desarrollo — ojo, si el 3000 está ocupado se va al 3001
npm run build           # producción
npm run lint
npx tsc --noEmit        # tipos
npx next typegen        # regenerar tipos de rutas si tsc se queja de .next/dev/types
npm run test:e2e        # pruebas de punta a punta (ver el aviso de abajo)
npm run test:e2e:ui     # las mismas, en el modo interactivo de Playwright
```

### `npm run test:e2e` habla con producción

No es una suite de laboratorio y conviene saberlo antes de lanzarla: las
pruebas de `tests/e2e/chat.spec.ts` conducen el widget de verdad, así que la
petición sale del navegador, pasa por `/api/chat`, viaja al n8n de
`n8n.robalfara.com`, consulta el Supabase de la pizzería y **gasta tokens**. Una
de ellas **crea una reserva real** y luego la consulta por su código, que es la
única forma de comprobar que `agente.crear_reserva()` escribió algo.

- El teardown (`tests/e2e/limpieza.ts`) borra esas filas al terminar, y solo
  esas: los `sessionId` que la corrida estrenó, apuntados uno a uno. Necesita
  `SUPABASE_DB_PASSWORD` en `.env.local` y `docker` disponible. Si no puede
  borrar, **falla ruidosamente** con el SQL que hay que pasar a mano, porque el
  fallo silencioso aquí es dejar mesas guardadas a gente que no existe.
- Hace falta `N8N_AGENTE_URL` en `.env.local`, o la landing no monta el widget
  y las pruebas de chat fallan sin explicar por qué.
- **Un worker, en serie y sin reintentos**, a propósito: los contadores de
  `lib/limites.ts` y de `agente.cuota()` son globales y compartidos, y dos
  workers a la vez se pisan hasta sacar 429 que no son fallos del código. El
  porqué de cada decisión está en la cabecera de `playwright.config.ts`.
- Las aserciones comprueban **hechos que solo puede dar una herramienta** (el
  precio que está en `public.platos`, la hora que está en `public.horarios`, un
  código `FN-XXXXX`), nunca frases literales: el agente redacta distinto cada
  vez.
- **El cubo de 20 mensajes cada 5 minutos no se prueba aquí**, y está razonado
  en la cabecera de `tests/e2e/guardas.spec.ts`: llenarlo exige 20 llamadas
  aceptadas al agente y dispararía el techo global, dejando en rojo todo lo que
  corriera detrás. Ese es terreno de un test unitario de `lib/limites.ts`.
- ⚠️ **`avisos.spec.ts` corta el chat a todo el mundo durante unos segundos.**
  Baja el interruptor de pánico (`agente.limites.activo = false`) para comprobar
  que el corte queda registrado, porque ese límite es del negocio y no hay forma
  de simularlo para una sola sesión. Lo sube en un `finally`, y además deja un
  testigo en `test-results/` que el teardown mira para reabrirlo si el proceso
  murió por el camino. El teardown **no** sube el interruptor sin testigo: si lo
  bajaste tú a propósito, una suite de pruebas no puede reabrirte el chat sola.

### La cuarentena de npm

`~/.npmrc` de esta máquina lleva `min-release-age=7`: se rechaza cualquier
versión publicada en los últimos siete días. Es la defensa barata contra el
paquete comprometido que se retira a las pocas horas, y conviene saberlo porque
el síntoma despista: pedir una versión recién salida no falla con un error de
red, falla con `ETARGET` / *No matching version found*, como si esa versión no
existiera.

Pendiente por ese motivo (a 2026-09-02): `next@16.3.4` y
`@supabase/supabase-js@2.114.0` están publicadas y en cuarentena. Subir a ellas
cuando caduque. `@supabase/ssr` y React ya están en la última.

## Puesta en marcha

1. `npm ci`
2. Copiar `.env.example` a `.env.local` y rellenarlo (ver notas del propio fichero).
3. Aplicar las migraciones de `supabase/migrations/` en orden desde el SQL
   Editor del dashboard. Para el chat hacen falta las cinco; para la landing
   sola, solo la `0001`. Los pasos con secretos están en `n8n/README.md`.

   ⚠️ **La `0004_limites.sql` va ANTES de desplegar el workflow**, no después.
   El workflow llama a `agente.cuota()` en el primer nodo que toca la base de
   datos y ese nodo **falla cerrado**: si la función todavía no existe, la
   llamada revienta, el IF se va por la rama de «sin cuota» y **el chat queda
   cortado entero** —no un mensaje, todos— hasta que se aplique la migración.
   Es la dirección segura y es la que más asusta si se despliega en el orden
   equivocado.

   ⚠️ **La `0003_agente.sql` cambió con la revisión de seguridad**, y el fichero
   corregido solo sirve para una base limpia: volver a pasarlo sobre una base que
   ya lo tenía no arregla nada, porque los `create index` y los `alter table` no
   se repiten solos. Para esa base está `supabase/delta-0003-revision-seguridad.sql`,
   que aplica los cambios uno a uno dentro de una transacción y trae delante las
   dos consultas que hay que mirar antes (nombres o teléfonos que ya no caben en
   las cotas nuevas, y duplicados que el índice nuevo ya no aceptaría).
4. En el dashboard, Authentication → URL Configuration: dar de alta la URL local
   en Redirect URLs, o los emails de confirmación no volverán a la app.

## Caveats que muerden

- **Ya no es un sitio estático.** Se quitó `output: "export"`: la sesión necesita
  cookies `httpOnly` y eso exige servidor. El despliegue requiere runtime Node
  (`next build` + `next start`, o Docker con `output: "standalone"`).
- **El middleware se llama `proxy.ts`** y corre siempre en Node; el runtime no es
  configurable. Su matcher **solo excluye estáticos, ninguna ruta de página**: las
  Server Actions viajan como POST a la ruta donde se usan, así que excluir una
  ruta también las deja sin cobertura, y sin ningún error visible.
- **El proxy no es la barrera de seguridad.** La barrera es `lib/dal.ts`. Toda
  Server Action revalida la sesión por su cuenta.
- **`cookies()` es async** y solo se puede escribir desde Server Actions y Route
  Handlers. El `setAll` de `lib/supabase/server.ts` va en `try/catch` por eso.
- **`getUser()`, nunca `getSession()`** en servidor: `getSession()` se limita a
  leer la cookie sin revalidar el JWT.
- **`redirect()` lanza** (`NEXT_REDIRECT`): nunca dentro de un `try/catch`.
- **Las `NEXT_PUBLIC_*` se incrustan en tiempo de build**, no de runtime: hace
  falta un build por entorno.
- **La carta vive solo en la base de datos** (`0002_carta.sql`), con los precios
  como enteros de céntimos, porque el agente de n8n tiene que poder leerla y no
  puede importar un módulo de TypeScript. `app/components/Menu.tsx` es un Server
  Component `async` que la lee con `obtenerCarta()` de `lib/dal.ts`; de
  `lib/data.ts` solo quedan `reviews` y `features`, que son textos de marketing
  sin equivalente en la base de datos. Subir un precio vuelve a ser un solo
  sitio.
- **La query de la carta no filtra por `disponible`, y es deliberado.** El
  filtro lo hace la policy RLS de `0002_carta.sql` (`using (disponible)`), o
  sea Postgres, una vez y para todo el que lea la tabla: marcar un plato agotado
  lo quita a la vez de la landing y de lo que cuenta el agente. Un `WHERE` en el
  DAL sería una segunda regla que recordar. Es justo lo que fallaba antes: el
  comentario de la migración prometía esa propiedad mientras la landing pintaba
  una copia hardcodeada que ni sabía que esa columna existía.
- **El widget no puede usar `crypto.randomUUID()`, y el motivo es de los que se
  descubren tarde.** Esa API está restringida a **contextos seguros**: HTTPS y
  `localhost`. Servido por `http://` a una IP de red —que es exactamente como se
  prueba el chat desde el móvil o desde otro portátil de la casa— la propiedad es
  `undefined` y la llamada revienta con *crypto.randomUUID is not a function*. El
  síntoma engaña: el chat se queda mudo al pulsar enviar, sin burbuja y sin nada
  a la vista; el error solo sale en la consola del navegador. Por eso
  `app/components/Chat.tsx` arma el UUID con `crypto.getRandomValues()`, que sí
  existe en contextos no seguros. Lo mismo valdrá para cualquier otra API de
  contexto seguro que se añada (`crypto.subtle`, portapapeles, notificaciones).
  La regresión está en `tests/e2e/contexto-inseguro.spec.ts`, que navega por la
  IP de red a propósito **y comprueba primero que `isSecureContext` sea false**,
  porque el resto de la suite va a `localhost` y ahí el fallo no se reproduce: la
  elección del host en `playwright.config.ts` era, sin saberlo, parte de las
  condiciones del experimento.
- **`/api/chat` rechaza más de lo que parece.** Un cuerpo con `content-length`
  por encima de 4 KB se corta con un **413** antes de parsear nada —1000
  caracteres de mensaje son poco más de 1 KB, y `request.json()` bufferea y
  parsea *antes* de que nadie mire el tope de caracteres—, y un POST con
  `Origin` de otro host se corta con un **403**. ⚠️ Ese guard compara el `Origin`
  contra el `Host` de la petición, así que el proxy de delante tiene que
  **conservar el Host original** (`proxy_set_header Host $host` en Nginx). Si lo
  reescribe con el nombre interno, el chat empieza a contestar 403 a todo el
  mundo.
- **Quien tenga el secreto del webhook llega a n8n sin pasar por `/api/chat`.**
  `N8N_AGENTE_SECRET` es lo único que protege la Production URL, y con esa
  cabecera se puede hablar con el agente directamente: sin cubos, sin techo
  global, sin cabeceras de cuota y sin que la app se entere. No es una fuga
  hipotética de la app —el secreto no sale del servidor— pero sí es el modo en
  que la capa de la app deja de estar en el camino: un `.env` filtrado, un
  volcado de logs de n8n, alguien probando con curl. Por eso el límite que de
  verdad acota la factura vive **dentro de n8n**, delante del nodo Agent, y no
  aquí.
- **`next.config.ts` fija las cabeceras de seguridad** —CSP, HSTS, `nosniff`,
  `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy` y `no-store` sobre
  `/cuenta`— y apaga `poweredByHeader`. Dos cosas que hay que saber de la CSP:
  - Es **estática y sin nonce**, así que lleva `'unsafe-inline'` en `script-src`:
    el App Router inyecta los datos del servidor en scripts inline
    (`self.__next_f.push(...)`) y sin nonce no hay forma de distinguirlos de uno
    inyectado. Ponerle nonce exige generarlo por petición en `proxy.ts`, y eso
    obliga a render dinámico en todas las rutas.
  - `connect-src 'self'` basta **solo mientras no exista ningún
    `createBrowserClient`**. Hoy el navegador no habla con Supabase: todo pasa
    por `lib/supabase/server.ts` y `proxy.ts`. El día que se añada un cliente de
    navegador (realtime, storage) hay que añadir aquí su origen o las llamadas
    fallarán **en silencio**, que es como fallan las cosas que bloquea una CSP.

## El límite de uso del chat

Hay **dos limitadores** y no hacen lo mismo. Tomar el primero por el segundo es
justo como se llega a una factura sorpresa.

| Capa | Dónde vive | Qué cuenta | Topes |
|---|---|---|---|
| **Filtro barato** | `lib/limites.ts`, memoria del proceso de Next | mensajes, por cliente y en total | 20 / 5 min por cliente · 30 / min y 400 / h globales |
| **Backstop** | `agente.cuota()` en Postgres (`0004_limites.sql`), que llama n8n | dólares y mensajes, persistente y compartido | 5,00 $/día · 300 msg/h global · 40 msg/h por sesión · aviso al 70 % |

**Por qué está partido así.** El webhook es barato; lo caro es el LLM. Gatear
dentro de n8n, en el nodo que va justo antes del Agent, basta para proteger la
factura: ahí ya hay credencial persistente y contadores que sobreviven a un
despliegue. Y delante, el filtro de la app corta el grueso del abuso sin pagar un
viaje a la base de datos — lo que rechaza no abre conexión, no despierta a n8n y
no gasta un token. Ese es el único motivo de que la primera capa exista.

⚠️ **No hay límite de gasto en la consola del proveedor.** Es una decisión del
dueño, no un olvido, y es la razón de que exista todo esto: estas dos capas son
lo único que acota la factura. El bloque 13.3 del checklist propio —«límite de
gasto y alerta en el proveedor, innegociable»— **sigue sin cumplirse**, y así
está anotado en `n8n/README.md`.

### La capa de la app — `lib/limites.ts`

Un solo punto de entrada, `comprobarLimite()`, con un solo consumidor,
`app/api/chat/route.ts`. Devuelve un veredicto plano; quien llama decide qué
contestar.

- **Cubo por cliente: 20 mensajes cada 5 minutos.** Lo que decide si eso sirve de
  algo no es el número, es la clave: es `usuario:<id>` con sesión y `ip:<...>`
  sin ella. Antes se troceaba por `sessionId`, y el de un anónimo salía de una
  cookie que emite este mismo servidor, así que quien no mandaba cookie
  estrenaba cubo en cada petición. Medido: 2000 peticiones sin cookie, 2000
  aceptadas; las mismas 2000 con un cookie-jar cortaban limpias en la 20.
- **Techos globales del proceso: 30 por minuto y 400 por hora.** Son la novedad,
  y son lo único de esta capa que no depende de que la identidad del cliente sea
  de fiar: sin ellos, N IPs inventadas eran N × 20 mensajes y el agregado no lo
  acotaba nada. El del minuto absorbe una punta real (un viernes bueno son ~12
  msg/min) y corta un script en seco; el de la hora existe porque el del minuto
  acota la punta pero no la duración —un bot que se quede en 30/min sostiene
  1.800 mensajes en una hora—. 400/h es ya el doble del tráfico esperado de un
  día entero, así que ningún cliente real lo ve.
- **Un rechazo no consume cuota en ningún cubo**, y no crea clave nueva en el
  Map. De ahí sale una cota dura del estado que ya no depende del tráfico: 30
  claves/min × (5 min de ventana + 1 min hasta el barrido) = 180 claves. Medido
  con 360.000 peticiones desde 360.000 IPs distintas.
- **El barrido del Map es amortizado**: como mucho uno por minuto, con un suelo
  de un segundo cuando hay más de 50.000 claves vivas. Antes se recorría entero
  en cada llamada, o sea O(claves) por petición: con 100.000 claves son ~10 ms
  de CPU **síncrona** por petición, y a cien peticiones por segundo el bucle de
  eventos se queda pinneado. Eso no tumba el chat, tumba la web entera, porque
  todo lo demás encola detrás. La corrección de la ventana no depende de cuándo
  tocó barrer: las marcas de la clave se filtran siempre, y son 20 como mucho.
- El reloj es `performance.now()`, **monótono**. Con `Date.now()`, un salto de
  NTP hacia atrás deja todos los cubos llenos hasta que se recupere —incluido el
  de la hora— y uno hacia delante los vacía todos de golpe.
- **Solo ve el tráfico que pasa por `/api/chat`.** Nada más.

⚠️ **Dos supuestos la sostienen, y si dejan de valer el límite deja de valer:**

1. **Hay un proxy de confianza delante** (Nginx, Traefik, Cloudflare…) que
   **reescribe** `x-forwarded-for` en vez de dejar pasar la que mande el cliente.
   Sin él la cabecera es una cadena que elige quien ataca, y el cubo por IP pasa
   a ser un límite que el atacante se pone a sí mismo. Si la app quedara expuesta
   directamente, esto tiene que leer la IP del socket o el límite se muda al
   proxy. El techo global es lo que queda en pie mientras tanto.
2. **El estado vive en memoria del proceso**: se reinicia en cada despliegue y no
   se comparte entre réplicas, así que con N instancias el tope real es N × tope.
   Para un servidor sobra; para más, esto se muda a Redis o al propio backstop.
   Y como no hay forma de reabrir un cubo a mano, si salta el de la hora el chat
   queda degradado hasta que las marcas envejezcan o hasta reiniciar el proceso.

**Esta capa no acota el gasto, y conviene decirlo con un número**: al peor caso
medido de 0,23 $ por mensaje, sus 400 mensajes/hora son ~92 $/hora atravesándola
entera sin romper ninguna regla.

### El backstop — `agente.cuota()`

Vive en `supabase/migrations/0004_limites.sql` y lo llama n8n **antes del nodo
Agent**, no la app. Devuelve una fila siempre, con cuatro comprobaciones en orden
y cortando en la primera que falle: `activo` → gasto del día → mensajes/hora
global → mensajes/hora de esa sesión. El gasto sale de `agente.turnos` cruzado
con la tabla `agente.precios`, no de una tarifa escrita en el código.

**Falla cerrado**: si no puede calcular el consumo —falta la fila de
configuración, alguien renombró una columna— devuelve `permitido = false`. Sin
tope en el proveedor, «no sé cuánto llevo gastado» y «puedo seguir gastando» no
pueden ser la misma respuesta.

**Se cambia con un UPDATE, sin desplegar y sin tocar n8n.** Ese es el punto de
que la configuración viva en la base de datos: un sábado a las 22:00, quien esté
de guardia abre el SQL Editor y cierra el grifo en diez segundos.

```sql
-- subir (o bajar) el presupuesto del día
update agente.limites set gasto_diario_max_usd = 15.00;

-- INTERRUPTOR DE PÁNICO: corta el chat entero a partir del turno siguiente.
-- Es lo primero que mira cuota(), antes de medir nada.
update agente.limites set activo = false;
update agente.limites set activo = true;    -- y así se vuelve a abrir

-- el ritmo, si hace falta aflojarlo o apretarlo
update agente.limites set mensajes_hora_max = 500, mensajes_hora_sesion_max = 60;

-- un precio que ha cambiado en el proveedor
update agente.precios set usd_por_millon_entrada = 4.00 where modelo = 'claude-opus-5';
```

El agente **no puede escribir aquí**, y tampoco leerlo: `agente_n8n` no tiene ni
`SELECT` sobre `agente.limites` ni sobre `agente.precios`; llega al dato por
`cuota()`, que es `security definer`. Si el chat pudiera escribir en esas tablas,
el tope de gasto sería una sugerencia —bastaría una inyección de prompt que
acabe en un `update`—.

El `sessionId` no ha cambiado con nada de esto: sigue siendo la clave de la
memoria del agente y de la trazabilidad, no la del gasto. Son dos cosas distintas
y ahora se ve.

### Enterarse de que ha saltado — `agente.avisos`

Un tope que corta el chat y no se lo cuenta a nadie es un tope que descubres por
una queja. Hasta el 2026-09-17 eso lo cubría un Telegram; el dueño lo retiró, y
el sustituto es la tabla `agente.avisos` (`0005_avisos.sql`), que escribe n8n
por `agente.registrar_aviso()`.

Cuatro niveles: `aviso` (70 % del presupuesto), `corte` (el chat ya no atiende),
`fallo` (`cuota()` no contesta y se rechaza por precaución) y `ejecucion` (una
ejecución del workflow ha reventado, vía `settings.errorWorkflow`).

```sql
select * from agente.avisos_recientes();   -- la última semana
select * from agente.avisos_recientes(1);  -- hoy
select agente.avisos_vistos();             -- dar por leído
```

**El antispam es un índice único**, no código: `(nivel, día local, huella)`.
Antes vivía en `$getWorkflowStaticData('global')` dentro de un nodo Code y tenía
dos modos de fallo documentados en su propio comentario —si el estado no llegaba
a persistir el aviso se repetía; si dos mensajes entraban a la vez, los dos
podían avisar—. Los cierra los dos, porque ahora la unicidad la garantiza
Postgres. Con huella vacía da un aviso por nivel y día; las ejecuciones caídas la
llenan con el nodo y el error, así que un bucle de fallos idénticos colapsa en
una fila y dos fallos distintos se ven los dos.

El agente **escribe y no lee**: `agente_n8n` solo tiene `EXECUTE` sobre
`registrar_aviso()`. Ni `SELECT` sobre la tabla, ni `avisos_recientes()`, ni
`avisos_vistos()` —quien silencia un aviso es una persona, y si el proceso que
genera los fallos pudiera marcarlos como vistos, un bucle se taparía a sí mismo—,
ni `purgar_avisos()`.

⚠️ **Esto registra, no empuja.** Hay que ir a mirarlo. Ningún canal notifica
porque ninguno tiene credencial en la instancia, y la base era el único destino
alcanzable sin crear una a mano. El día que la haya, su nodo se cuelga del mismo
`Redactar aviso` y la tabla se queda como el histórico, que es justo lo que a
Telegram le faltaba.

## n8n

Tres cosas distintas que se llaman «n8n» en este repo; no confundirlas. Las dos
primeras son integraciones con propósitos opuestos (una gestiona la instancia,
la otra le avisa desde la app); la tercera es el agente que atiende el chat.

### Gestionar la instancia — API pública v1

`scripts/n8n.py`, cliente stdlib de la Public API: crear, versionar y depurar
workflows desde el repo. Credenciales en `.env.local` (mismos nombres que el
repo de CyP, a propósito: un solo patrón por máquina):

```
N8N_API_URL=https://n8n.synax.ddns.net
N8N_API_KEY=      # Settings → n8n API → Create an API key
```

```bash
python3 scripts/n8n.py list                        # id, activo, nombre
python3 scripts/n8n.py get <id> [fichero.json]     # bajar para versionar
python3 scripts/n8n.py create <f.json>
python3 scripts/n8n.py update <id> <f.json> --yes
python3 scripts/n8n.py activate|deactivate <id>
python3 scripts/n8n.py executions [--workflow <id>]
python3 scripts/n8n.py execution <id>              # datos nodo a nodo
python3 scripts/n8n.py raw GET /lo-que-sea         # escotilla
```

- El schema es `additionalProperties: false` en `node` y en `workflowSettings`,
  y el GET devuelve claves que el PUT rechaza con 400 (`binaryMode`,
  `availableInMCP`, `timeSavedMode`). El script las filtra del payload.
- La API key da **escritura sobre toda la instancia**, no solo sobre lo de la
  pizzería. Por eso `update`, `deactivate` y `delete` exigen `--yes`.
- **Si `N8N_API_URL` no empieza por `https://`, el script aborta.** La API key
  viaja en una cabecera en cada petición, y con `http://` iría en claro sin que
  nada avisara. Única excepción, `http://localhost` y `http://127.0.0.1`: ahí el
  tráfico no sale de la máquina y un n8n de pruebas rara vez tiene TLS.
- Lleva User-Agent propio: urllib con el suyo por defecto se come un 403 detrás
  de según qué proxy.
- El endpoint MCP (`/mcp-server/http`) **no** sirve para esto: expone workflows
  como herramientas, no gestiona la instancia.

### Avisar a n8n desde la app — webhook saliente

`lib/n8n.ts` → `notificarN8n(evento, datos)`. Variables opcionales:

```
N8N_WEBHOOK_URL=      # URL del Webhook node
N8N_WEBHOOK_SECRET=   # openssl rand -base64 32
```

- **Sin variables es un no-op silencioso**: la app arranca igual sin n8n.
- **Nunca lanza.** Un workflow caído no puede tumbar un alta de cliente; el
  error se registra en el log del servidor y la acción sigue.
- Sin prefijo `NEXT_PUBLIC_`: el secreto no puede acabar en el bundle.
- Se invoca dentro de `after()` de `next/server` para no hacer esperar al
  usuario. `after()` se ejecuta incluso si la acción termina en `redirect()`.
- El secreto viaja en la cabecera `x-webhook-secret` y tiene que coincidir con
  la credencial Header Auth del Webhook node, o la URL es un endpoint público.
- La **Test URL** de n8n solo escucha mientras esté activo "Listen for test
  event". Para que funcione siempre: workflow en Active y **Production URL**.

### El agente conversacional — chat de la landing

`n8n/README.md` es la ficha completa. En corto: el chat de la web lo atiende un
agente que vive en n8n (`[Forno Nostro] Agente de sala`, id `3YCjY6GXMCE2YnyN`)
y que cuenta la carta, dice horarios y **crea reservas de verdad**.

> ✅ **Desplegado y sincronizado desde el 2026-09-17.** Repo e instancia se
> compararon nodo a nodo y conexión a conexión: 35 nodos, sin diferencias más
> allá de los valores por defecto que n8n quita al guardar (`public: false`,
> `mode: 'manual'`…), que no son divergencias reales. El workflow está publicado
> y probado de punta a punta desde la web. Para volver a subirlo desde el repo:
>
> ```bash
> python3 scripts/n8n.py update 3YCjY6GXMCE2YnyN n8n/forno-nostro-agente.json --yes
> ```
>
> Dos cosas alrededor de ese comando, y las dos muerden:
>
> 1. **Antes**: el JSON versionado trae `"id": "REEMPLAZAR"` en las credenciales
>    a propósito (un id de credencial no es un secreto, pero tampoco es lo mismo
>    en dos instancias). Hay que sustituirlos por los de la instancia destino, o
>    el workflow sube sin credenciales asignadas.
> 2. **Después**: pasar la evaluación **entera**, y contra un proyecto de
>    Supabase **de pruebas**. Hay casos que crean reservas de verdad y casos del
>    grupo `seguridad` que dependen de las reservas que crean los anteriores.
>
> ⚠️ **Una cosa que el JSON versionado NO trae**: la `path` del nodo `Webhook`
> dice `REEMPLAZAR-ruta-del-webhook`. Este repo es público y la ruta de
> producción no tiene por qué estarlo —no es lo que protege el endpoint, eso es
> la Header Auth, pero tampoco se regala—. Hay que ponerla antes de subir el
> JSON a una instancia, igual que los ids de credencial.

- El navegador **nunca** habla con n8n. Pasa por `app/api/chat/route.ts`, que es
  quien tiene el secreto y quien decide el `sessionId`. Si el `sessionId` lo
  mandara el cliente, mandar el de otro bastaría para leerse su conversación.
- n8n **no tiene acceso a ninguna tabla**. El rol `agente_n8n` solo tiene
  `EXECUTE` sobre once funciones del schema `agente` (ocho de la `0003`, más
  `cuota` y `anular_turno` de la `0004` y `registrar_aviso` de la `0005`). Las reglas de negocio
  (turnos, aforo, antelación, grupos de más de 12) están en esas funciones y no
  en el prompt: un prompt es una sugerencia bien redactada, una constraint es una
  regla.
- Las tools se probaron solas contra un Postgres desechable antes de conectar
  ningún LLM. Si se tocan, se vuelven a probar igual.
- Al cambiar el system prompt hay que pasar `python3 scripts/evaluar_agente.py`
  **entero**. El fallo que busca no es «no funciona», es «he arreglado A y he
  roto B».
- **El evaluador ya no da verde con el agente caído.** Cinco de los casos no
  llevan aserciones —son de criterio, se leen a ojo—, así que con el webhook
  muerto salían en verde y el script terminaba con código 0: exactamente el falso
  verde que la suite existe para evitar. Ahora, una llamada que no llega a
  contestar (HTTP, timeout, DNS) falla el caso.
- El evaluador **también exige `https://` en `N8N_AGENTE_URL`**, por el mismo
  motivo que `scripts/n8n.py`: el secreto del webhook viaja en cabecera. Misma
  excepción para localhost.
- Los casos de reserva de la evaluación **crean reservas reales**. Contra
  producción se llena la agenda de un sábado con gente que no existe.

### Saber de n8n — skills oficiales (plugin)

`n8n-skills@n8n-io` (marketplace `n8n-io/skills`), instalado con **ámbito de
proyecto** y declarado en `.claude/settings.json`, que sí está versionado. Trae
14 skills sobre expresiones, loops, subworkflows, agentes, manejo de errores,
credenciales y depuración, más un hook SessionStart que carga la meta-skill
`using-n8n-skills-official` al arrancar la sesión.

```bash
claude plugin marketplace add n8n-io/skills --scope project
claude plugin install n8n-skills@n8n-io --scope project
```

- El plugin **también trae un MCP** (`n8n-mcp` → `<n8n_url>/mcp-server/http`),
  y su `n8n_url` se deja **sin configurar**: sin valor, ese servidor no se
  registra. El acceso MCP a la instancia se declara en el `.mcp.json` del
  proyecto (ver abajo), y dos caminos al mismo host solo multiplican
  credenciales y diálogos de permiso.
- Las skills se cargan al **arrancar la sesión**: tras instalar hace falta
  `/reload-plugins` o abrir una sesión nueva.

### Hablar con la instancia por MCP — `.mcp.json`

`.mcp.json` (versionado) declara el servidor `n8n` contra
`https://n8n.robalfara.com/mcp-server/http`. Expone **35 herramientas**:
`search_nodes`, `get_node_types`, `validate_workflow`, `create_workflow_from_code`,
`test_workflow`, `list_credentials`, las de Data Tables…

El fichero **no contiene el token**, solo la referencia `${N8N_MCP_TOKEN}`. Hay
que exportarla antes de arrancar, con la convención de leer una sola clave:

```bash
export N8N_MCP_TOKEN=$(grep '^N8N_MCP_TOKEN=' .env.local | cut -d= -f2-)
claude
```

- Sin esa variable, `claude mcp list` avisa con *Missing environment variables*
  y el servidor no levanta.
- Un servidor de un `.mcp.json` de proyecto **pide aprobación explícita** la
  primera vez. Hasta darla sale como *Pending approval*.
- Los cambios en `.mcp.json` y en `pluginConfigs` se leen **al arrancar la
  sesión**: tocarlos a mitad no hace nada hasta reiniciar.
- El MCP da **escritura sobre toda la instancia** (`publish_workflow`,
  `archive_workflow`, `execute_workflow`), igual que la API key. No es un
  cliente de solo lectura.
- Aun así, **`scripts/n8n.py` sigue siendo el camino para versionar**: el JSON
  del workflow vive en este repo y de ahí se sube. El MCP sirve para explorar
  la instancia y validar formas de nodo sin adivinarlas.
- ⚠️ Hay además un conector `n8n` **a nivel de cuenta en claude.ai** apuntando a
  `https://n8n.synax.ddns.net/mcp-server/http`, que hoy falla con 502. Es un
  tercer camino y a un host distinto: conviene borrarlo o apuntarlo aquí.

### Skills de terceros — CLI `skills` y `skills-lock.json`

Se versiona `skills-lock.json` (origen y hash de cada una) y se ignora el
contenido descargado en `.agents/`, que son varios MB de terceros. Los enlaces
de `.claude/skills/` que apuntan ahí tampoco van al repo.

| Skill | Origen |
|---|---|
| `frontend-design` | `anthropics/skills` |
| `nextjs-supabase-auth` | `sickn33/antigravity-awesome-skills` |
| `supabase` | `supabase/agent-skills` |
| `supabase-postgres-best-practices` | `supabase/agent-skills` |

**Restaurar en un clon nuevo son DOS pasos.** El primero descarga; el segundo es
el que hace que Claude Code las vea.

```bash
cd "$(git rev-parse --show-toplevel)"

# 1 · descargar desde el lockfile  (el comando es experimental_install, no
#     `install` — `skills install` no existe y da "Missing required argument")
npx --yes skills experimental_install

# 2 · enlazar para Claude Code — experimental_install NO lo hace, y sin esto
#     las skills quedan "not linked" y son invisibles
for d in .agents/skills/*/; do
  s=$(basename "$d")
  ln -sfn "../../.agents/skills/$s" ".claude/skills/$s"
done

# 3 · verificar: las cuatro deben decir "Agents: Claude Code"
npx --yes skills list
```

- ⚠️ **El resumen final de `experimental_install` engaña**: cierra con un
  recuadro tipo *«Installed 1 skill»* que corresponde al último lote, no al
  total. La fuente fiable es `skills list`, o `ls .agents/skills/`.
- ⚠️ **`experimental_install` puede reescribir `skills-lock.json`.** Si una
  skill cambió en su repo de origen, el CLI descarga lo nuevo y actualiza el
  `computedHash`, y el fichero sale modificado en `git status`. Eso **no** es
  ruido: significa que un tercero cambió código que corre con permisos completos
  del agente. Auditar antes de commitear el hash nuevo y, si no convence,
  revertir el lockfile y reinstalar para quedarse en la versión anterior.
- ⚠️ **El `computedHash` del lockfile no es un `sha256sum` del `SKILL.md`**: lo
  calcula el CLI a su manera, así que no se puede verificar fuera de banda con
  `sha256sum skills/<x>/SKILL.md`. La única forma de comprobarlo es volver a
  correr el CLI. Importa porque el punto de arriba manda auditar el hash cuando
  cambie: lo que se audita es el **diff del contenido descargado** en
  `.agents/skills/<x>/`, no el número del lockfile, que solo sirve de aviso.
- ⚠️ **`nextjs-supabase-auth` es la candidata a salir**, pendiente de decisión.
  Su origen, `sickn33/antigravity-awesome-skills`, es un agregador de un
  particular que a su vez declara haber copiado la skill de otro sitio; y
  `supabase/agent-skills` —ya en el lockfile, y de primera mano— cubre el mismo
  terreno. Si se quita hay que tocar tres sitios: el lockfile, la línea del
  `.gitignore` y el enlace de `.claude/skills/`.
- Añadir una nueva: `npx --yes skills add <owner>/<repo> --skill <nombre>`. Si
  el nombre no existe, el CLI lista los disponibles en ese repo. Actualizar
  todas: `npx --yes skills update`.

El mismo mecanismo, con el mismo lockfile, se usa en `plataforma-relacional-
vertical-saas`; su skill `setup-entorno` lo documenta para aquel repo.

### Skill propia — diseñar y auditar agentes

`.claude/skills/agente-n8n/`, versionada en el repo. Destila el checklist
*Anatomía de un agente en n8n* (Ailink, v2) en un procedimiento: test de la
pizarra (¿agente o workflow?), las cuatro fases en orden, la regla de corte
—ningún 🔴 en seguridad ni operación delante de un cliente— y una tabla de
síntoma → bloque. Las fases viven en `references/` y se cargan de una en una.

Cubre el **criterio**; el **cómo** en n8n lo cubren las `n8n-*-official`. Los
puntos conservan la numeración del checklist (`2.11`, `6.3`) para poder citarlos
contra el entregable original.

# Revisión bajo demanda — activador: `ejecutar la revisión de seguridad`

El informe de la última pasada está en `docs/revision-seguridad-2026-09-02.md`:
qué se probó, qué se encontró, qué se corrigió y qué queda pendiente. Casi todos
los caveats nuevos de este documento salen de ahí.

Siempre que solicite una revisión, inicia subagentes y ejecuta dos líneas de análisis conforme a los estándares actuales de la industria, iterando hasta que todos los hallazgos **críticos, altos y medios** hayan sido resueltos y superen nuevamente las comprobaciones:

## 1. Calidad del código

* Cumplimiento de la arquitectura y las capas.
* Corrección.
* Gestión de errores.
* Seguridad de tipos.
* Concurrencia y ciclo de vida de los recursos.
* Duplicación.
* Código muerto.
* Facilidad de prueba.
* Mantenibilidad.

## 2. Seguridad

Realiza un análisis estático más una prueba de penetración activa (*pentest*) contra la lista de comprobación de la industria correspondiente (las familias de OWASP o el equivalente para el stack):

* Autenticación.
* Autorización y propiedad de los objetos a nivel individual.
* Inyecciones.
* Gestión de secretos.
* Vulnerabilidades de dependencias.
* Configuraciones incorrectas.
* Filtración de información y errores.
* Transporte y cabeceras de seguridad.

## Cómo

### Verifica primero la legitimidad

Da preferencia a herramientas oficiales/de primera mano y a tus propios subagentes previamente evaluados.

Antes de ejecutar cualquier *skill* de moda o definición de agente/subagente de terceros:

1. Comprueba su procedencia.
2. Lee qué hace.
3. Nunca ejecutes definiciones no confiables con permisos para utilizar herramientas.
4. Prioriza ejecuciones de herramientas efímeras en lugar de instalar cualquier cosa.

### Solo dentro del alcance autorizado

Prueba únicamente sistemas que sean de mi propiedad o para los que tenga autorización.

* Da preferencia a objetivos locales/de desarrollo.
* Nunca interactúes con producción, sistemas de terceros o sistemas de clientes sin una autorización explícita.

### Clasifica los hallazgos

Clasifica cada hallazgo como:

* **Crítico**
* **Alto**
* **Medio**
* **Bajo**
* **Informativo**

Para cada hallazgo, proporciona:

* Una reproducción concreta o la ruta exacta del código.
* Una explicación clara del problema.
* Una corrección mínima y concreta.

### Corrige y vuelve a verificar

Resuelve todos los elementos **críticos, altos y medios**.

Después:

1. Vuelve a ejecutar las comprobaciones.
2. Verifica que las correcciones funcionan.
3. Repite el proceso hasta que todos los hallazgos críticos, altos y medios hayan sido resueltos y superen las comprobaciones.

Los elementos de nivel **bajo/informativo** deben documentarse, pero no es necesario corregirlos.

### Informa de los resultados

El informe debe indicar:

* Qué se probó.
* Qué se encontró.
* Qué se corrigió.
* Qué queda pendiente.

Conserva el informe en el repositorio cuando merezca la pena mantenerlo.


## Estructura

```
app/
├── (auth)/            # /login y /registro (el grupo no sale en la URL)
├── api/chat/          # puerta del agente: decide quién eres y habla con n8n
├── auth/confirmar/    # route handler del enlace de confirmación
├── cuenta/            # área de cliente
└── components/        # Navbar, Hero, Menu, Reviews, Chat, Footer...
lib/
├── dal.ts             # data access layer: la barrera de auth
├── supabase/          # clientes de servidor y de proxy
├── validacion.ts      # validación de formularios y destinoSeguro()
├── n8n.ts             # aviso saliente a n8n (opcional, nunca lanza)
├── agente.ts          # cliente HTTP del agente (ya no lleva el límite)
├── limites.ts         # cubos por cliente y techos globales del proceso
└── data.ts            # reseñas y features de la landing (la carta está en la BD)
n8n/                   # workflows versionados + ficha del agente + evaluación
docs/                  # informes que merece la pena conservar (revisión de seguridad)
proxy.ts               # refresco de sesión (antes middleware.ts)
next.config.ts         # cabeceras de seguridad y CSP, además de la config de Next
scripts/n8n.py         # cliente de la Public API de n8n
scripts/evaluar_agente.py  # pasa el set de evaluación contra el agente
.claude/skills/        # agente-n8n/ es nuestra; el resto, enlaces a .agents/skills/
supabase/migrations/   # SQL, fuente de verdad del esquema
    0004_limites.sql   # presupuesto, ritmo y purgas: el backstop de gasto
    0005_avisos.sql    # agente.avisos: enterarse de que el backstop ha saltado
supabase/reparacion-grants-public.sql  # devuelve los grants de public a anon/authenticated
tests/e2e/            # pruebas de punta a punta con Playwright (hablan con producción)
supabase/delta-0003-revision-seguridad.sql  # solo para bases con la 0003 vieja
```
