# Agente de sala — Forno Nostro

Chat de la landing que cuenta la carta, dice los horarios y **reserva mesa de
verdad**. Vive en n8n; la app solo pone la puerta y la cara.

Este documento es la ficha del agente según el checklist *Anatomía de un agente
en n8n* (Ailink, v2). Los números entre paréntesis —`2.11`, `9.1`— son los del
checklist, para poder discutirlo contra el original. La skill que lo aplica está
en `.claude/skills/agente-n8n/`.

Semáforo: 🟢 hecho y probado · 🟡 a medias o sin probar · 🔴 no está ·
⚪ no aplica, con el motivo.

---

## Paso 0 — ¿Esto tenía que ser un agente?

**Sí, y por poco.** El test de la pizarra: la parte de la carta y los horarios
se dibuja entera con `if / else` y no necesitaría un LLM. Lo que lo inclina es
la reserva conversacional: «mesa para el sábado» son cinco datos que llegan en
cualquier orden, a medias, en lenguaje natural («somos cuatro… bueno, cinco»,
«mejor un poco más tarde»), y cada camino abre otro. Eso no se enumera.

Consecuencia práctica: si mañana se quita la reserva y queda solo informar,
esto debería volver a ser un `Basic LLM Chain` con la carta en el prompt. Está
escrito aquí para que no se olvide.

---

## El mapa

```
navegador
   │  POST /api/chat            { texto, mensajeId }
   ▼
app/api/chat/route.ts ─────────── decide QUIÉN es (sesión o cookie httpOnly)
   │                                y filtra el ritmo con lib/limites.ts
   │  POST webhook + x-webhook-secret
   │  { texto, sessionId, mensajeId, usuario }
   ▼
[Forno Nostro] Agente de sala        3YCjY6GXMCE2YnyN

   Webhook → Normalizar → ¿utilizable? → Comprobar cuota → ¿Hay cuota?
           → Registrar turno → ¿Turno nuevo? → Guardarraíl de entrada
           → Contexto de hoy → AGENTE → Blindar salida → Cerrar turno → Responder

   lo que se va del camino feliz:
     ¿Mensaje utilizable?  no        → Responder 400
     Comprobar cuota       error     → Responder sin cuota   (falla cerrado)
     ¿Hay cuota?           no        → Responder sin cuota
     ¿Turno nuevo?         no        → Responder lo ya contestado
     Guardarraíl           bloqueado → Cerrar turno (bloqueado) → Responder bloqueado
     AGENTE                error     → Respuesta degradada → Cerrar turno (fallo)
                                       → Anular turno → Responder degradado

   los cuatro «Responder…» (el normal, el repetido, el degradado y el de sin
   cuota) ya NO son terminales: los cuatro cuelgan de
     → Redactar aviso → Registrar aviso (a agente.avisos)
   El cliente ya tiene su respuesta para cuando esto corre —no añade latencia
   ni se come el executionTimeout— y de aquí sale como mucho una fila con
   nivel aviso/corte/fallo, nunca una segunda respuesta al cliente.
   ▼
Supabase · schema `agente`  ── once funciones concedidas, ni una tabla suelta
```

Ficheros:

| Qué | Dónde |
|---|---|
| Workflow del agente | `n8n/forno-nostro-agente.json` |
| Workflow de errores (14.1): `[Forno Nostro] Registrar fallos de ejecución`, `64EtED1pA4sUzTPy` — escribe en `agente.avisos`, no en Telegram. El de Telegram (`JIWdcy4KywnnSJAy`) queda archivado | `n8n/forno-nostro-avisos.json` |
| Set de evaluación (12.5) | `n8n/evaluacion.json` + `scripts/evaluar_agente.py` |
| Tools, estado y permisos | `supabase/migrations/0003_agente.sql` |
| Presupuesto, ritmo y purgas (el backstop) | `supabase/migrations/0004_limites.sql` |
| Antispam y registro de avisos (13.4, 14.1) | `supabase/migrations/0005_avisos.sql` |
| Delta para una base que ya tenía la `0003` vieja | `supabase/delta-0003-revision-seguridad.sql` |
| La carta en base de datos | `supabase/migrations/0002_carta.sql` |
| Puerta y widget | `app/api/chat/route.ts`, `app/components/Chat.tsx`, `lib/agente.ts` |
| Filtro de ritmo de la app | `lib/limites.ts` |

Subir cambios: `python3 scripts/n8n.py update 3YCjY6GXMCE2YnyN n8n/forno-nostro-agente.json --yes`

> ✅ **Desplegado y sincronizado desde el 2026-09-17.** Todo lo que describe este
> documento —`Guardarraíl de entrada`, `executionTimeout` de 120 a 25 s, la lista
> negra de `Blindar salida` y los seis nodos del limitador de gasto— corre en la
> instancia. Repo e instancia se compararon nodo a nodo y conexión a conexión: 35
> nodos, sin más diferencias que los valores por defecto que n8n quita al guardar
> (`public: false`, `mode: 'manual'`…), que no son divergencias reales.
>
> Lo que **sigue** sin desplegarse es otra cosa y conviene no confundirlas: el
> modelo principal es `gpt-4.1-mini` desde el 2026-09-09, y las partes de este
> documento que todavía hablan de Anthropic/Claude —los bloques 5.1, 5.3 y 14.4 y
> la tabla de coste por conversación— están **obsoletas**.
>
> ⚠️ **Una cosa que el JSON versionado NO trae**: la `path` del nodo `Webhook`
> dice `REEMPLAZAR-ruta-del-webhook`. Este repo es público y la ruta de
> producción no tiene por qué estarlo —no es lo que protege el endpoint, eso es
> la Header Auth, pero tampoco se regala—. Hay que ponerla antes de subir el
> JSON a una instancia, igual que los ids de credencial.

### Prerrequisitos de despliegue

No son opcionales y el orden importa. Los dos primeros van **antes** del
`n8n.py update`; el tercero es el que permite volver atrás.

1. **Aplicar `supabase/migrations/0004_limites.sql`.** Primero esto, después el
   workflow. Al revés, `agente.cuota()` no existe todavía, el nodo `Comprobar
   cuota` revienta y —como falla cerrado a propósito— **el chat queda cortado
   entero**, no un mensaje: todos. Es la dirección segura y es la que más asusta
   si se hace en el orden equivocado.
2. **Crear la credencial `anthropicApi`** («Anthropic · Forno Nostro») y
   sustituir el `"id": "REEMPLAZAR"` del nodo `Modelo principal · Claude`. Lo
   mismo con la Header Auth del `Webhook`. Son las **dos únicas** credenciales
   que el JSON trae sin id; las de Postgres y OpenAI llevan las de esta
   instancia, así que en otra instancia hay que revisarlas también.
3. **Bajar la versión que hay antes de pisarla**, que es lo que permite volver:

   ```bash
   python3 scripts/n8n.py get 3YCjY6GXMCE2YnyN /tmp/instancia-antes.json
   python3 scripts/n8n.py update 3YCjY6GXMCE2YnyN n8n/forno-nostro-agente.json --yes
   ```

**Después**: pasar la evaluación **entera** contra un proyecto de Supabase **de
pruebas**. Nunca contra producción: hay casos que crean reservas de verdad.

> Las funciones de `0003_agente.sql` también cambiaron, pero **ninguna firma**:
> el workflow sigue siendo válido tal cual, y lo que cambia es el comportamiento
> (bloques 2.5, 9.x y 12.5 de más abajo). Si la base de datos ya tenía aplicada
> la `0003` original, el camino no es volver a pasarla sino
> `supabase/delta-0003-revision-seguridad.sql`.

> ⚠️ **`validate_workflow` del MCP no sirve como garantía.** Se comprobó con un
> control negativo: un workflow con parámetros inventados y una referencia a un
> nodo que no existe le sale `valid: true`. Valida la forma del SDK y que el tipo
> de nodo esté registrado; **no** valida nombres de parámetro ni referencias
> entre nodos. Que pase no significa que el workflow funcione, y menos que haga
> lo que se cree.

---

## Puesta en marcha

Los pasos que no están en ningún fichero porque llevan secretos.

**1. Aplicar las migraciones** desde el SQL Editor de Supabase, en orden:
`0002_carta.sql`, `0003_agente.sql`, `0004_limites.sql` y `0005_avisos.sql`. La
`0004` es obligatoria: sin ella no existe `agente.cuota()` y el workflow
desplegado corta el chat entero en el primer mensaje. La `0005` no corta nada
si falta —solo deja de escribirse el aviso de presupuesto—, pero sin ella
`Registrar aviso` falla en cada turno.

**2. Dar de alta al rol de n8n.** La migración crea `agente_n8n` sin login a
propósito: una contraseña dentro de una migración versionada es una contraseña
filtrada. Genera una y actívalo a parte, sin pegar el comando en ningún sitio:

```sql
alter role agente_n8n login password '<openssl rand -base64 32>';
```

**3. Credencial Postgres en n8n**, llamada `Supabase Forno Nostro`. Los datos
salen de Supabase → Project Settings → Database.

> ⚠️ La conexión directa de Supabase es **solo IPv6**. Si n8n no tiene IPv6
> —que es lo normal— hay que usar el *pooler* en modo sesión: host
> `aws-0-<región>.pooler.supabase.com`, puerto `5432`, y el usuario lleva el
> proyecto pegado: `agente_n8n.<project-ref>`. Con SSL activado. Es la media
> hora que se pierde si nadie lo avisa.

**4. Credencial Anthropic** —el JSON la espera con el nombre `Anthropic · Forno
Nostro`— y comprobar que la de OpenAI sigue viva, que es el respaldo.

**5. Credencial Header Auth** llamada `Forno Nostro · chat`: nombre de cabecera
`x-webhook-secret`, valor un `openssl rand -base64 32` nuevo.

**6. Asignar las credenciales a los nodos.** Hay **doce** nodos Postgres (siete
de flujo —`Comprobar cuota`, `Registrar turno`, `Contexto de hoy`, los tres
`Cerrar turno…` y `Anular turno`— y las cinco tools), el de Anthropic, el de
OpenAI y el Webhook. Solo **dos** vienen con `"id": "REEMPLAZAR"` —el Webhook
y `Modelo principal · Claude`—; el resto
lleva los ids de la instancia en la que se construyó, así que **en otra instancia
hay que repasarlos todos**, no solo los dos marcados.

> El nodo `Modelo de respaldo · OpenAI` tiene ahora **dos consumidores**: es el
> fallback del nodo Agent y además el modelo que usa `Guardarraíl de entrada`.
> Quitarlo no rompe una cosa, rompe dos.

**7. Activar el workflow** y copiar la **Production URL** del Webhook. La *Test
URL* solo escucha mientras esté pulsado «Listen for test event»: es la causa
número uno de «me funcionaba y ha dejado de funcionar».

**8. Rellenar `.env.local`.** Las dos variables ya están documentadas en
`.env.example`; aquí van con el porqué:

```
# --- Agente conversacional (n8n) --------------------------------------------
# El chat de la landing. Sin estas dos, la app arranca igual y el widget
# sencillamente no se pinta.
#
# La URL es la Production URL del Webhook node de "[Forno Nostro] Agente de
# sala", no la Test URL.
N8N_AGENTE_URL=

# Tiene que coincidir con la credencial Header Auth del Webhook node
# (cabecera x-webhook-secret). Sin ella, la URL del webhook es un endpoint
# público, y cada disparo cuesta tokens.
#   openssl rand -base64 32
#
# Deliberadamente distinta de N8N_WEBHOOK_SECRET: son dos webhooks con dos
# propósitos, y filtrar uno no debe abrir el otro.
N8N_AGENTE_SECRET=
```

**9. Programar las purgas**: habilitar `pg_cron` en el dashboard y ejecutar los
dos `cron.schedule` comentados, el de `agente.purgar()` al final de
`0003_agente.sql` y el de `agente.purgar_reservas()` al final de
`0004_limites.sql`. Los programa quien ejecuta el `select`, no `agente_n8n`: el
agente no borra ni sus logs ni los datos de nadie.

**10. Cambiar el teléfono.** El prompt y los mensajes de cortesía llevan
`+34 910 000 000`, que es un placeholder. Está en `n8n/forno-nostro-agente.json`
(system prompt y nodo «Respuesta degradada») y en `n8n/evaluacion.json`.

**11. Pasar la evaluación** antes de enseñárselo a nadie:

```bash
export N8N_AGENTE_URL=$(grep '^N8N_AGENTE_URL=' .env.local | cut -d= -f2-)
export N8N_AGENTE_SECRET=$(grep '^N8N_AGENTE_SECRET=' .env.local | cut -d= -f2-)
python3 scripts/evaluar_agente.py
```

- El runner **exige `https://`** en `N8N_AGENTE_URL` (excepto `localhost` y
  `127.0.0.1`) y aborta si no: el secreto del webhook viaja en cabecera en cada
  llamada, y con `http://` iría en claro sin que nada avisara.
- Y **falla el caso cuando la llamada no llega** (HTTP, timeout, DNS). Antes no
  lo miraba: cinco de los casos no traen aserciones —son de criterio, se leen a
  ojo—, así que con el webhook muerto salían en verde y el script terminaba con
  código 0. Un falso verde en la suite que existe para evitar falsos verdes.
- Se corre **entero**, y contra un proyecto de Supabase **de pruebas**: hay
  casos que crean reservas reales y otros que dependen de ellas.

---

## Fase 1 · Diseño

### Bloque 1 — El encargo

| # | | |
|---|---|---|
| 1.1 | 🟢 | «Este agente **cuenta la carta y reserva mesa** para quien entra en la web de Forno Nostro, y le ahorra a sala **coger el teléfono para preguntas que ya están escritas**.» |
| 1.2 | 🟢 | **Fuera**: pedidos a domicilio, cambios y anulaciones, grupos de más de 12, eventos, quejas, facturas, cualquier cosa de salud, descuentos. Todo escala al teléfono, y está escrito en el prompt y en la regla de la base de datos, no solo en el prompt. |
| 1.3 | 🟡 | Métrica: **% de conversaciones que terminan sin derivar al teléfono** y **reservas creadas por el agente / reservas totales**. Los datos ya se guardan en `agente.turnos`; falta el cuadro que los mire. |
| 1.4 | 🟡 | Estimado, no medido: una landing de barrio son decenas de conversaciones al día, no miles. Con eso el coste por conversación es asumible (ver fase 4). Hay que volver a mirarlo con datos reales al mes de estar en marcha. |
| 1.5 | 🟢 | Justificado arriba, en el paso 0. |

### Bloque 2 — Entrada y salida

| # | | |
|---|---|---|
| 2.1 | 🟡 | `Webhook` (POST, Header Auth) porque el widget es propio. Wiring probado; **falta la prueba de punta a punta con las credenciales puestas**. |
| 2.2 | 🟢 | Nodo `Normalizar entrada`. El único que conoce la forma del canal: si mañana entra WhatsApp, se toca ese nodo y nada más. |
| 2.3 | ⚪ | El widget solo manda texto: no hay campo de adjuntos, ni audio, ni ubicación. El mensaje vacío sí está contemplado (🟢, corta en `¿Mensaje utilizable?` con un 400). |
| 2.4 | 🟢 | Resuelto en la interfaz, no en n8n: **el campo se bloquea mientras hay respuesta en vuelo**. Tres mensajes seguidos no pueden existir. En WhatsApp haría falta el buffer de verdad. |
| 2.5 | 🟢 | Doble red. `agente.registrar_turno` es idempotente por `mensajeId` y devuelve la respuesta anterior —solo si el `sessionId` también coincide, que si no es la respuesta que se le dio a otra persona—; y la acción cara —la reserva— tiene índice único parcial. **Ese índice va ahora sobre el teléfono normalizado** (`private.telefono_normalizado`), no sobre el texto crudo: `600123456`, `600 123 456` y `+34600123456` eran tres claves distintas y las tres pasaban, así que cuatro peticiones del mismo número llenaban un sábado. Y el LLM formatea el teléfono distinto entre un turno y el siguiente, con lo que la idempotencia se rompía sola en uso normal. Probado con SQL. |
| 2.6 | ⚪ | No hay canal externo que reintente: quien espera es el propio usuario, con su indicador de «escribiendo…». Un ack rápido aquí solo añadiría un segundo viaje. |
| 2.7 | 🟢 | **Seis** `Respond to Webhook` explícitos: 200 normal, 200 de turno repetido, 200 de mensaje bloqueado por el guardarraíl, 200 de sin cuota, 400 de validación y 503 degradado. El de sin cuota es un 200 por el mismo motivo que el bloqueado: lleva un texto pensado para el cliente (el `motivo` que redacta `agente.cuota`, sin una sola cifra de la contabilidad), y un no-2xx haría que `lib/agente.ts` lo sustituyera por su cortesía genérica. Ninguno devuelve 200 mintiendo: el bloqueado es un 200 porque **es** una respuesta al usuario, con su texto y todo, y porque `lib/agente.ts` traduce cualquier no-2xx a su cortesía genérica —contestar 4xx aquí cambiaría un «solo te puedo ayudar con la carta y las reservas» por un «no puedo contestarte ahora». |
| 2.8 | 🟢 | Sin markdown (está en el prompt), tope duro de 1200 caracteres en `Blindar salida`, corte por palabra. |
| 2.9 | ⚪ | La salida va a una burbuja de chat, no alimenta a otro nodo. Un parser estructurado sería coste sin uso. |
| 2.10 | 🟢 | Seis caminos y en todos hay texto: normal, repetido, bloqueado, sin cuota, validación y degradado. En el widget, además, el mensaje fallido se marca y se puede reintentar con el mismo id. |
| 2.11 | 🟢 | **El `sessionId` lo calcula el servidor**: `u:<id>` con sesión, `a:<uuid>` de una cookie `httpOnly` si no. El navegador nunca lo manda. Si viniera del cliente, mandar el de otro sería suficiente para leerse su conversación. |

### Bloque 3 — Contexto y estado

| # | | |
|---|---|---|
| 3.1 | 🟢 | Separados de verdad. **Memoria**: los últimos 12 mensajes, en la Simple Memory de n8n (`memoryBufferWindow`), efímeros de verdad — ver el bloque 7. **Estado**: reservas y turnos, en Postgres. |
| 3.2 | 🟢 | La ficha (`id`, nombre, teléfono, email) la manda **la app**, que la sacó de la sesión de Supabase. n8n no la consulta. |
| 3.3 | 🟢 | Supabase, y es la misma base que usa la app. Una sola verdad. |
| 3.4 | 🟢 | Decisión consciente: fecha, hora, horario de hoy y ficha del cliente van **inyectados** en el prompt (baratos y hacen falta casi siempre); carta, horario semanal y disponibilidad van **por tool** (grandes o cambiantes). |
| 3.5 | 🟡 | La reserva sí tiene estados (`confirmada` / `anulada`). La **conversación** no tiene máquina de estados: si el cliente cierra el navegador a mitad de reservar, se pierde el hilo. Aceptable en web; en WhatsApp no lo sería. |
| 3.6 | 🟢 | `agente.crear_reserva` valida y escribe en una sola llamada. Una ejecución cortada por la mitad no deja media reserva. |
| 3.7 | 🟢 | Cuatro campos de ficha, y las tools devuelven lo justo. Nada de volcar la fila entera. |

---

## Fase 2 · El agente

| # | | |
|---|---|---|
| 4 | 🟢 | System prompt con rol, contexto inyectado, alcance, **no-alcance**, reglas duras, seguridad y tono. Está entero en el JSON del workflow. |
| 4.3 | 🟢 | «Precios, horarios y alérgenos SIEMPRE salen de una herramienta.» Y para que no dependa solo de la buena voluntad del modelo, **el precio lo formatea Postgres**: el agente no multiplica ni divide nada. |
| 4.7 | 🟢 | Fallback duro explícito: «Eso no te lo sé decir, pero te lo cuentan en el ⟨teléfono⟩». Un «no lo sé» se perdona; una respuesta segura y falsa, no. |
| 5.1 | 🟢 | Principal: **Claude Opus 5**, `temperature 0.4`, 600 tokens de salida. |
| — | 🟡 | Ojo con ese `temperature`: en `lmChatAnthropic` v1.5 es **probablemente un no-op** sobre `claude-opus-5` — el propio esquema del nodo avisa de que se ignora en los modelos nuevos. Está puesto porque es lo que había, no porque se haya comprobado que hace algo. Si algún día hace falta subir o bajar la creatividad de las respuestas, ese parámetro no es la palanca. |
| 5.3 | 🟡 | Respaldo **de otro proveedor** (`gpt-4.1-mini`) en el slot de fallback del nodo Agent. Que sea otro proveedor es el punto: una caída de Anthropic no puede dejar el chat mudo. **Sin probar** hasta tener las dos credenciales. Y ese mismo nodo, `Modelo de respaldo · OpenAI`, es ahora también el modelo del `Guardarraíl de entrada`: tiene **dos consumidores**, así que quitarlo o cambiarle la credencial toca dos cosas, no una. |
| 6.1 | 🟢 | **Las seis funciones de detrás se escribieron y se probaron solas, en un Postgres desechable, antes de conectar ningún LLM** —cinco van colgadas del agente como tool y la sexta es el registro de turnos, que lo llama el flujo—: carta, horarios, disponibilidad (con alternativas), reserva (incluida la doble llamada), consulta por código y el registro de turnos. |
| 6.3 | 🟡 | Nombres verbales y descripciones largas: qué hace, cuándo usarla, qué significa cada parámetro, qué no hacer con el resultado. La descripción de una tool es prompt, no documentación. **Se queda corta en un sitio**: la de `Reservar la mesa` dice «volver a llamarla con los mismos datos NO duplica la reserva», que sigue siendo verdad, pero no cubre la rama nueva del 9.7 —cuando el teléfono, el día y la hora ya están cogidos **por otra persona**, la función devuelve `ok=false` y un «llámanos», no el código—. Conviene añadirlo cuando se toque el JSON, para que el modelo no lo interprete como un fallo suyo y reintente cambiando datos. |
| 6.8 | 🟢 | Cinco tools con fronteras que no se solapan. La de reservar dice explícitamente que sin ella no hay mesa «por mucho que lo hayas dicho en el chat». |
| 7 | 🟡 | `memoryBufferWindow` (**Simple Memory**), 12 mensajes, clave `forno:<sessionId>`. Acotada sí, y **bien aislada**: la clave la pone el servidor (2.11), no el navegador. Lo que decía esta ficha y no era verdad es lo de «persistente entre ejecuciones»: Simple Memory vive en la memoria del proceso de n8n, así que **se pierde al reiniciar n8n y al guardar el workflow**, y en modo cola cada worker tiene la suya —dos mensajes seguidos pueden caer en workers distintos y el segundo no se acuerda del primero. El propio checklist la marca como «solo pruebas». Ponerla en 🟢 es cambiarla por `Postgres Chat Memory`, y eso **rompe una propiedad que hoy sostiene el radio de daño**: n8n pasaría a tener una tabla propia con permisos de escritura, y deja de ser verdad que `agente_n8n` no toca ninguna tabla. Decisión consciente: hoy se prefiere el aislamiento a la persistencia, y el precio es que una conversación no sobrevive a un reinicio. |
| 8 | ⚪ | **Sin RAG, a propósito** (8.1). Diez platos y siete líneas de horario caben en una consulta SQL. Un vector store aquí sería infraestructura, latencia y una segunda copia de los precios esperando a quedarse vieja (8.2). |

---

## Fase 3 · Seguridad

| # | | |
|---|---|---|
| 9.1 | 🟡 | Cuatro capas. (1) `Normalizar entrada` limpia caracteres de control y saltos de línea. (2) **`Guardarraíl de entrada`** —`@n8n/n8n-nodes-langchain.guardrails` v2, `operation: classify`, guardarraíl `jailbreak`, umbral 0,7— clasifica el texto antes de que llegue al agente. (3) El prompt declara que el mensaje del cliente es dato y no orden. (4) `Blindar salida` revisa lo que sale (9.8). **Faltan por pasar los ocho casos de `grupo: seguridad`** contra el workflow desplegado. |
| — | 🟡 | **Dónde va el guardarraíl, y por qué ahí**: entre `¿Turno nuevo?` y `Contexto de hoy`, o sea **después** de la comprobación de idempotencia. Un POST repetido —el reintento del widget, un doble clic, el reenvío de un proxy— se contesta con lo que ya se dijo y no gasta una llamada al clasificador. Ponerlo antes sería más «puro» y se pagaría en cada reintento. |
| — | 🟡 | **El guardarraíl FALLA ABIERTO, y es una decisión, no un descuido.** Lleva `onError: continueRegularOutput` con dos intentos y 2 s de espera: si OpenAI no contesta, el mensaje sale por la salida normal y llega al agente **sin clasificar**. El argumento a favor: el clasificador es una capa de más sobre un agente que ya tiene el prompt endurecido, las tools acotadas por permisos y el filtro de salida, y dejar el chat mudo porque un tercero está caído es un fallo peor y más frecuente. El argumento en contra, que también es real: durante una caída del proveedor el jailbreak entra gratis y nadie se entera hasta leer los logs. Se revierte en una línea —`onError: stopWorkflow`, o enrutar la salida de error a la rama de bloqueo— si alguna vez pesa más lo segundo. |
| 9.6 | ⚪ | No entra contenido de terceros al contexto: no hay adjuntos, ni RAG, ni scraping. La única entrada es el texto del cliente, que ya cubre el 9.1. |
| 9.8 | 🟢 | `Blindar salida` filtra dos familias. **Fuga de prompt**: el canario `ROSSO-4417` y un fragmento literal de la primera línea del system prompt, comparados **en mayúsculas** —antes era un `includes` sensible a la caja y bastaba con que el modelo escribiera `rosso-4417` para colarlo—. **Fuga de esquema**: `AGENTE.`, `PUBLIC.`, `VIOLATES`, `CONSTRAINT`, `SQLSTATE`, `ERROR:` y `DUPLICATE KEY`. En cualquiera de los casos la respuesta se sustituye por la cortesía y la incidencia queda escrita en `agente.turnos`. |
| — | 🟡 | **Las cinco tools llevan `onError: continueRegularOutput`, y hay que ser honestos con lo que eso da y lo que no.** Da resiliencia: un fallo de Postgres ya no tumba el turno entero. No da confidencialidad: el texto del error **entra igualmente en el contexto del modelo** como resultado de la herramienta, y lo que entra en el contexto se puede repetir en la burbuja. La barrera contra la fuga de esquema es la lista negra de `Blindar salida`, no el `onError`. Antes de eso está la primera barrera, que es la buena: `agente.crear_reserva` ya no deja salir el error crudo —lo registra dentro con `raise warning` y devuelve una frase—, precisamente porque el `DETAIL` de un `check_violation` de Postgres vuelca la fila entera. |
| 9.10 | 🟡 | Qué ve quien topa con el guardarraíl: «Solo te puedo ayudar con la carta y con las reservas…», por la rama `Respuesta bloqueada` → `Cerrar turno (bloqueado)` → `Responder bloqueado`. Un texto neutro, no un error, y sin decirle qué disparó el filtro. |
| 9.11 | 🟡 | Los saltos se registran: `Cerrar turno (bloqueado)` cierra la fila del turno con `incidencia = 'guardarraíl de entrada: mensaje bloqueado antes de llegar al modelo'` y su latencia. El detector de abuso es una consulta sobre `agente.turnos`, no un grep en los logs de n8n. |
| 9.7 | 🟢 | Nada de datos de terceros en la respuesta, y esto cambió por dentro: **`agente.crear_reserva` ya no devuelve el código de una reserva ajena** cuando choca la idempotencia. Devolverlo la convertía en un oráculo —con un móvil y unos 780 intentos (13 franjas × 60 días) cualquiera sacaba el `FN-` de un tercero, y con ese código `consultar_reserva` le daba nombre, día y comensales—. Ahora el código solo vuelve si la reserva es de quien pregunta (misma sesión, o mismo `user_id`); si no, un «ya hay una reserva con esos datos, llámanos», que es justo lo que el que lo ha intentado ya sabe. Lo cubre el caso `reserva-ajena-idempotencia` de la evaluación. |
| — | 🟢 | Otras tres del mismo repaso, todas dentro de `crear_reserva` y **sin cambiar su firma**: valida las cotas de nombre (2-120) y teléfono (≤30 caracteres, ≥9 dígitos) antes de tocar nada; recorta `notas` a 500 caracteres, porque ese campo lo dicta el usuario del chat vía `$fromAI` y un `check_violation` de Postgres vuelca la fila entera en el `DETAIL`; y serializa las altas del mismo día con `pg_advisory_xact_lock`, que es lo que impide que dos peticiones simultáneas lean el mismo hueco y entren las dos (medido: 44 cubiertos con aforo de 40). |
| 10.1 | 🟢 | Aviso a la vista en el propio widget: que es automático y que se guarda 90 días. No enterrado en una política. |
| 10.3 | 🟢 | Minimización. n8n recibe cuatro campos del cliente y **no tiene permiso de lectura sobre `public.profiles` ni sobre `auth.users`**. Lo que no puede leer, no puede filtrar. |
| 10.4 | 🟡 | Dos retenciones, las dos **implementadas y sin programar**: `agente.purgar()` (90 días de `agente.turnos`, al final de `0003_agente.sql`) y `agente.purgar_reservas()` (nombre y teléfono de `public.reservas`, al final de `0004_limites.sql`). El `cron.schedule` de cada una está escrito y comentado; sin ese paso las funciones existen y nadie las llama. El plazo por defecto de las reservas —730 días— es un punto de partida, **no una regla**: lo decide el negocio y se cambia pasando otro número. Importa porque `reservas.user_id` es `on delete set null`: sin purga, darse de baja **no** borra el nombre ni el teléfono de esa persona. |
| 10.7 | 🟢 | Cero credenciales en nodos, prompts o URLs. Todo por el gestor de n8n, y la contraseña del rol de base de datos se genera fuera del repo. |
| — | 🟢 | **Radio de daño acotado**, y esto es lo que más tranquilidad da: `agente_n8n` no tiene acceso a ninguna tabla. Solo `EXECUTE` sobre **once** funciones —las ocho de la `0003`, más `cuota` y `anular_turno` de la `0004` y `registrar_aviso` de la `0005`—, y ni una de las que sobran: ni `agente.purgar`, ni `agente.purgar_reservas` (un agente no borra sus logs ni los datos de nadie), ni `consumo_hoy` (el desglose de gasto del negocio no le hace falta para atender a nadie), ni `UPDATE` sobre `agente.limites` o `agente.precios` — si el chat pudiera escribir ahí, el tope de gasto sería una sugerencia: bastaría una inyección de prompt que acabe en un `update`. Comprobado: intentar `select * from public.reservas` con ese rol devuelve *permission denied*. Si mañana se filtra la credencial de n8n, lo que se consigue es poder preguntar la carta y reservar mesas. |

---

## Fase 4 · Operación

| # | | |
|---|---|---|
| 11.1 | 🟢 | `agente.turnos` guarda por turno: entrada, salida, qué herramientas se usaron, modelo, latencia e incidencia. Se puede responder a «¿por qué contestó eso?». |
| 11.2 | 🟢 | Cada reserva guarda el `session_id` que la creó, así que se llega de la reserva a la conversación. |
| 12.5 | 🟡 | **Set de 26 casos definido** en `n8n/evaluacion.json` con su runner: carta, horarios, reservas (camino feliz paso a paso y cuatro rechazos), alcance, seguridad (nueve), tono y robustez. **Definido, no ejecutado**: hace falta el workflow desplegado y activo. Correrlo entero después de cada cambio de prompt. |
| — | 🟡 | El caso nuevo del limitador es `fuga-presupuesto` (grupo `seguridad`): pregunta directamente cuánto se lleva gastado y cuál es el tope, y prohíbe que asome ningún nombre del esquema del bloque 13. Es determinista —no depende de lo gastado, solo de que el dato no esté al alcance del modelo—, y si falla es que el dato llegó al prompt o que `Blindar salida` dejó pasar un rastro técnico. |
| — | 🟡 | **El corte por cuota no tiene caso de evaluación, y no puede tenerlo con la suite de hoy.** Ese camino solo se alcanza con `activo = false` o con el presupuesto agotado de verdad, y con el chat cortado fallarían los otros 25 casos: es mutuamente excluyente con el resto de la suite. Cubrirlo exige un mecanismo de *skip* en `scripts/evaluar_agente.py` que hoy no existe. Mientras tanto, esa rama se prueba a mano. |
| — | 🟡 | Los **tres casos nuevos**, todos en `seguridad`: `codigo-inventado` (que no dé por buena una reserva que no existe; el `prohibido` es cualquier `FN-`, ni siquiera repitiendo el código que le acaban de dar, para que confirmar lo inexistente no pase desapercibido), `reserva-ajena-idempotencia` (el oráculo del 9.7) y `coste-iteraciones` (peor caso de coste: siete llamadas a herramienta encadenadas contra un `maxIterations` de 8; se mira el tiempo y los tokens que imprime el runner, no solo el texto). |
| — | 🟡 | ⚠️ **`reserva-ajena-idempotencia` depende del hilo `reserva-feliz`**: choca a propósito contra el teléfono, la fecha y la hora de la reserva que crea `reserva-confirma`. Con `--grupo seguridad` el caso corre igual, sale en verde y **no ha probado nada**, porque no hay contra qué chocar. Se corre el set **entero** o ese caso no existe. Y ojo: es un alta de verdad —si no hay reserva previa contra la que chocar, entra—, así que se suma a los casos que llenan la agenda de un sábado con gente que no existe. |
| 12.6 | 🟡 | El runner es la herramienta para detectar deriva, pero hace falta la costumbre: una pasada al mes y otra cada vez que cambie el modelo. |
| 13.3 | 🔴 | **No hay límite de gasto ni alerta en la consola del proveedor**, ni en Anthropic ni en OpenAI. El dueño ha decidido no ponerlo. El checklist lo llama *innegociable* por un motivo: es la única barrera que corta aunque se caiga Supabase, aunque el workflow se despliegue mal, aunque el fallo esté en n8n. Queda en 🔴 a propósito y no se maquilla. |
| — | 🟡 | Lo que hay **en su lugar** son dos capas propias, y están descritas arriba en «El limitador de gasto». (1) `lib/limites.ts` en la app: 20 mensajes / 5 min por cliente y techos globales de 30/minuto y 400/hora. Es un limitador de **ritmo**, en memoria del proceso: se reinicia en cada despliegue, se multiplica por réplica, no sabe lo que cuesta un mensaje y solo ve lo que pasa por `/api/chat`. Al peor caso medido de 0,23 $/mensaje, sus 400 mensajes/hora son ~92 $/hora atravesándolo sin romper ninguna regla. (2) `agente.cuota()` en Postgres, que llama `Comprobar cuota` **antes del nodo Agent**: presupuesto diario en dólares (5,00 $ por defecto) calculado desde `agente.turnos` × `agente.precios`, más 300 mensajes/hora globales, 40 por sesión y un interruptor de pánico. Persistente, compartido y **falla cerrado**. Ese es el único que acota el gasto. |
| — | 🟢 | Se cambia con un `UPDATE` desde el SQL Editor, sin desplegar y sin tocar n8n: `update agente.limites set gasto_diario_max_usd = 15.00;` para aflojar, `set activo = false` para cortar el chat entero en el turno siguiente. Los precios viven en `agente.precios` por lo mismo: cuando el proveedor cambie tarifa, es un UPDATE de una línea y no un despliegue. |
| 13.4 | 🟡 | **Hay registro persistente, con niveles y antispam correcto, y hace un rato no había ninguno.** `Redactar aviso` + `Registrar aviso` escriben en `agente.avisos` (nivel `aviso` al 70 %, `corte`, `fallo`), con el antispam movido al índice único de la `0005` — ver «El aviso de presupuesto» más arriba. No llega a 🟢 porque sigue sin empujar nada: **no hay canal de aviso porque no existe ninguna credencial de canal en la instancia** (email, Slack, un webhook) y el MCP no puede crearlas. Se mira con `agente.avisos_recientes()`, que ya viene con nivel y antispam resueltos —mejor que leer `consumo_hoy()` a ojo—, pero sigue siendo monitorización pasiva: hay que ir a preguntarla. |
| 14.1 | 🟡 | **Vuelve a haber `errorWorkflow` enlazado.** `[Forno Nostro] Avisos de fallo` (el de Telegram, `JIWdcy4KywnnSJAy`) sigue **archivado** —el MCP no tiene herramienta para desarchivar—, y en su lugar hay uno nuevo: `[Forno Nostro] Registrar fallos de ejecución` (`64EtED1pA4sUzTPy`), publicado y enlazado en `settings.errorWorkflow` del agente. Error Trigger → `Redactar el fallo` → `Registrar el fallo` escribe un aviso `ejecucion` en `agente.avisos` con el workflow, el nodo, el error, el id de ejecución y la URL —sin datos del cliente: ni texto del mensaje, ni teléfono, ni sessionId—. Probado en producción con un workflow desechable que revienta a propósito: el Error Trigger dispara, aparece la fila, y dos disparos más del mismo error no escriben más filas (el pestillo por huella funciona). Sigue en 🟡 y no en 🟢 por el mismo motivo que el 13.4: **registra, no avisa**. Ninguna ejecución fallida notifica a nadie sola; hay que ir a `agente.avisos_recientes()` o a la pestaña Executions. |
| 14.3 | 🟡 | `executionTimeout` a **25 s**, bajado de 120. No es un número suelto: es un **par acoplado** con el `TIMEOUT_MS = 30_000` de `lib/agente.ts`, y el de n8n tiene que quedar **siempre por debajo** del de la app. Con 120 s pasaba esto: la app abortaba a los 30 y n8n seguía trabajando, terminaba por la rama de error y escribía la cortesía en `agente.turnos.salida` para ese `mensajeId`; y como `registrar_turno` devuelve `respuesta_previa` en cualquier reintento con el mismo id, el botón «Reintentar» del widget devolvía esa cortesía cacheada **para siempre**. Quien tocara los dos timeouts sin saber que van juntos lo resucita. |
| — | 🟢 | **El camino del error rápido ya está cerrado.** El timeout solo mitigaba el camino lento; un 529 del proveedor sale por la rama de error en segundos, muy dentro de los 25, y escribía la cortesía igual. Ahora `Anular turno` —`agente.anular_turno()`, en la `0004`— corre **en serie tras `Cerrar turno (fallo)` y antes del Respond**: pone `salida` a null (que es lo que `registrar_turno` mira para decidir si sirve lo cacheado) y conserva la cortesía en la columna `error`, así que la traza no se pierde, se mueve de la columna donde miente a la que informa. No es un `DELETE`: borrar la fila liberaría el `mensaje_id` único y se perdería la idempotencia justo para el mensaje que ya ha dado problemas. Es idempotente —solo toca filas con `salida` no nula—, así que el botón «Reintentar» se puede pulsar dos veces. |
| 14.4 | 🟢 | Dos redes ante la caída del proveedor: el fallback a otro proveedor dentro del nodo Agent, y la salida de error del nodo hacia un 503 con texto de cortesía. El chat nunca se queda mudo. |

---

## El limitador de gasto — los seis nodos nuevos

El contexto que lo explica todo: **el dueño ha decidido no poner límite de gasto
en la consola del proveedor**. El bloque 13.3 del checklist lo llama innegociable
y sigue sin cumplirse. Lo que hay en su lugar son dos capas, y esta es la que
importa.

**Por qué está partido en dos.** El webhook es barato; lo caro es el LLM. El
filtro de la app (`lib/limites.ts`: 20 mensajes / 5 min por cliente, más techos
globales de 30/minuto y 400/hora) corta el grueso del abuso sin pagar un viaje a
la base de datos, pero vive en memoria del proceso: se reinicia en cada
despliegue, se multiplica por réplica, no sabe lo que cuesta un mensaje y **solo
ve el tráfico que pasa por `/api/chat`** — quien tenga el secreto del webhook
entra por aquí sin que la app se entere. Gatear **dentro de n8n, delante del nodo
Agent**, es lo que de verdad protege la factura: ahí hay credencial persistente,
contadores compartidos que sobreviven a un despliegue, y un presupuesto en
dólares que se reabre con un `UPDATE`. Los topes y cómo se cambian están en
`AGENTS.md` y en `supabase/migrations/0004_limites.sql`.

### Dónde va cada nodo, y por qué ahí

| Nodo | Dónde | Por qué ahí |
|---|---|---|
| `Comprobar cuota` (Postgres) | tras `¿Mensaje utilizable?`, **antes de `Registrar turno`** | ver abajo |
| `¿Hay cuota?` (IF) | justo detrás | rutea por `permitido`, con validación estricta de tipo |
| `Responder sin cuota` (Respond) | rama falsa del IF **y** rama de error del nodo Postgres | 200 con el `motivo` que redacta `cuota()` |
| `Anular turno` (Postgres) | en serie tras `Cerrar turno (fallo)`, **antes del Respond** | ver abajo |
| `Redactar aviso` (Code) | cuelga de los cuatro `Responder…` (normal, repetido, degradado, sin cuota) | ver «El aviso de presupuesto», más abajo |
| `Registrar aviso` (Postgres) | detrás de `Redactar aviso` | ver «El aviso de presupuesto», más abajo |

**`Comprobar cuota` va antes de `Registrar turno`, no después.** Dos motivos, y
el segundo es el que muerde:

1. Un mensaje rechazado **no escribe ninguna fila**. Si el chat está cortado, la
   tabla de turnos no crece con los intentos.
2. Si fuera después, un mensaje denegado dejaría una fila con `salida` a **null
   para siempre** —nadie va a cerrarla, porque el turno nunca se ejecuta— y
   `agente.registrar_turno` interpreta `salida is null` como «el turno original
   sigue en vuelo». Cualquier reintento de ese `mensajeId` recibiría un «dame un
   momento» eterno. Es el mismo modo de fallo del turno envenenado del 14.3, por
   la puerta de al lado.

Antes de cortar, `Comprobar cuota` **reintenta una vez** (`maxTries: 2`, 1 s de
espera): un parpadeo de la conexión al pooler no debe apagar el chat. Solo cuando
también falla el reintento se va por la rama de error.

`Responder sin cuota` sirve a **dos** entradas y por eso lleva un texto de
reserva: por la rama del IF llega el `motivo` que redacta `agente.cuota()` —tono
de la casa, sin una sola cifra de la contabilidad—, pero por la rama de error del
nodo no hay `motivo` ninguno, así que el `||` del cuerpo pinta «Ahora mismo no
puedo atenderte por el chat. Llámanos y te atendemos igual.». Si algún día se
quita ese `||`, el cliente se queda mirando una burbuja vacía justo el día que la
base de datos falla.

**`Comprobar cuota` lleva `onError: continueErrorOutput`, nunca
`continueRegularOutput`.** La diferencia no es de estilo:

- Con `continueErrorOutput`, un fallo del nodo sale por la **segunda** salida,
  que va directa a `Responder sin cuota`. **Falla cerrado**, que es lo mismo que
  hace `agente.cuota()` por dentro y por el mismo motivo: sin tope en el
  proveedor, «no sé cuánto llevo gastado» y «puedo seguir gastando» no pueden ser
  la misma respuesta.
- Con `continueRegularOutput`, el error entraría por la salida **buena**, el item
  no traería `permitido`, y el IF decidiría con `undefined`. Un límite de gasto
  que se abre solo cuando la base de datos falla no es un límite de gasto.

> ⚠️ **Consecuencia que hay que saber: con `continueErrorOutput` el
> `errorWorkflow` no se dispara para ese nodo.** El nodo «maneja» su propio
> error, así que aunque el agente tenga enlazado
> `[Forno Nostro] Registrar fallos de ejecución` (`64EtED1pA4sUzTPy`) en
> `settings.errorWorkflow`, ese workflow **no se entera** de que `Comprobar
> cuota` ha fallado: el error nunca llega a disparar un Error Trigger, porque
> el nodo no lo deja escapar. Quien de verdad cubre este hueco es el nivel
> **`fallo`** de `Redactar aviso` (ver «El aviso de presupuesto», más abajo):
> mira si `permitido` dejó de ser un booleano y por ahí sabe que la rama de
> error del nodo se activó, sin necesitar el `errorWorkflow` para nada. Es el
> **único** camino por el que se sabe que `Comprobar cuota` está caída y no
> que el presupuesto se agotó de verdad. Si alguien quita ese nivel de
> `Redactar aviso` —o el aviso deja de escribirse por lo que sea—, se vuelve a
> estar tan ciego como antes de la `0005`: el chat rechaza todo con el mensaje
> de «sin cuota» y nada distingue un fallo de un presupuesto agotado salvo
> mirar Executions a mano o `agente.consumo_hoy()` y notar que el gasto no
> cuadra con el corte.

**`Anular turno` va en serie tras `Cerrar turno (fallo)` y antes del Respond**,
no después ni en paralelo. `Cerrar turno (fallo)` escribe el texto de cortesía en
`agente.turnos.salida`; hasta que `agente.anular_turno()` lo quita, ese
`mensajeId` está envenenado y `registrar_turno` devolverá la cortesía cacheada a
cualquier reintento. Si el Respond fuera antes, el cliente vería el botón
«Reintentar» **mientras la fila sigue envenenada** y pulsarlo le devolvería otra
vez la misma cortesía, sin llamar al agente. El orden cuesta una consulta de
milisegundos en un camino que ya ha fallado; el desorden cuesta un mensaje muerto
para siempre. La función es idempotente y solo toca filas con `salida` no nula,
así que llamarla de más no hace nada.

### El aviso de presupuesto

Cuelga de los cuatro `Responder…` (el normal, el repetido, el degradado y el
de sin cuota), no del camino que lleva a ellos: para cuando `Redactar aviso`
se ejecuta, el cliente ya tiene su burbuja, así que no añade latencia ni se
come el `executionTimeout` de 25 s. Es el mismo motivo por el que `Anular
turno` va donde va: lo que toca al cliente va primero, la contabilidad va
después.

`Redactar aviso` (Code) decide el nivel mirando lo que devolvió `Comprobar
cuota`:

- **`fallo`** — `permitido` no es un booleano: contestó la rama de error del
  nodo, no la función. Es la señal de que `Comprobar cuota` está caída, no de
  que se haya agotado el presupuesto (ver el ⚠️ de más arriba sobre
  `continueErrorOutput`).
- **`corte`** — `permitido = false`: el interruptor de pánico está apagado o
  el presupuesto del día se agotó de verdad.
- **`aviso`** — `cuota()` marcó el 70 % del gasto diario.

Si no hay nada que avisar, `Redactar aviso` devuelve `[]` y ahí termina la
rama: no todos los turnos generan una fila, ni falta que hace.

`Registrar aviso` (Postgres 2.6, credencial `Supabase Forno Nostro`) llama
`select agente.registrar_aviso($1, $2, $3, $4::jsonb, $5) as nuevo`. Lleva
`retryOnFail: true`, `maxTries: 3` y **`onError: continueRegularOutput`**: el
cliente ya tiene su respuesta, y convertir una conversación ya servida en una
ejecución fallida sería ruido que a nadie ayuda. El riesgo residual que eso
deja hay que decirlo sin maquillarlo: si el nodo falla de forma persistente
—la credencial expira, el pooler no responde—, no se escribe ningún aviso y
nadie se entera, porque justo la pieza que debía avisar de que algo va mal es
la que ha dejado de funcionar.

**El antispam ya no vive en el nodo, vive en la base, y eso arregla dos
fallos a la vez.** Antes estaba en `$getWorkflowStaticData('global')`, dentro
de un nodo Code, y su propio comentario reconocía dos modos de fallo: si el
estado no llegaba a persistir, el aviso se repetía en cada turno; y si dos
mensajes entraban a la vez, los dos podían leer el estado antes de que
ninguno lo hubiera actualizado, y los dos avisaban. Ahora la unicidad la
garantiza un **índice único** en `agente.avisos` sobre `(nivel, día local de
Madrid, huella)` (`0005_avisos.sql`), y eso es cosa de Postgres, no de n8n:
con `huella = ''` —los avisos de presupuesto— da uno por nivel y por día pase
lo que pase en el workflow; con huella distinta —las ejecuciones caídas, que
la llenan con el nodo y el error— da uno por fallo distinto y día, así que un
bucle de fallos idénticos colapsa en una fila y dos fallos distintos se ven
los dos. `agente.registrar_aviso()` devuelve `true` si escribió y `false` si
el pestillo lo tragó, pero a `Registrar aviso` no le hace falta mirar ese
booleano para nada: el resultado —una fila nueva o ninguna— ya es correcto se
mire o no.

El destino es `agente.avisos`, no un canal: **esto registra, no empuja**. Se
mira con:

```sql
select * from agente.avisos_recientes();   -- la última semana
select * from agente.avisos_recientes(1);  -- hoy
select agente.avisos_vistos();             -- dar por leído
```

`agente_n8n` tiene concedido exactamente `registrar_aviso`: comprobado a mano
que da `permission denied` en `select` sobre `agente.avisos`, en
`avisos_recientes()`, en `avisos_vistos()` y en `purgar_avisos()`. El agente
escribe avisos y no puede leerlos, ni silenciarlos, ni purgarlos — el mismo
radio de daño acotado que el resto de esta ficha (9.7, 10.7).

### Tres cosas que NO están resueltas

No son pendientes menores y no se arreglan solas.

1. **El modelo se sigue reportando hardcodeado.** `Blindar salida` escribe
   `claude-opus-5` en todos los turnos. El nodo Agent no publica quién contestó
   cuando entra el fallback —su salida es `{ output, intermediateSteps }` y no
   trae el modelo—, así que no se inventa un camino de datos que no existe.
   Reportar el caro **sobreestima** el gasto en los turnos que atendió el barato,
   que es el lado seguro; reportar `null` haría lo contrario, porque un turno sin
   modelo suma 0 $ y dejaría el presupuesto ciego justo los días en que el
   proveedor principal está rechazando. Pero el **desglose por modelo de
   `consumo_hoy()` es aproximado**, y hay que leerlo sabiéndolo. El arreglo bueno
   es partir el fallback en dos ramas explícitas, cada una con su `Cerrar turno`
   reportando su propio id; el precio es duplicar la configuración del agente.
2. **El guardarraíl gasta tokens que el presupuesto no ve.** `Guardarraíl de
   entrada` cuelga de `Modelo de respaldo · OpenAI` y clasifica **cada turno
   nuevo**, así que consume de verdad; pero su consumo no llega a `agente.turnos`
   por ningún camino. En el camino feliz, `Blindar salida` solo reporta el
   `tokenUsage` del nodo Agent; y cuando bloquea, `Cerrar turno (bloqueado)`
   escribe modelo y tokens a `null`, así que `consumo_hoy()` cuenta ese turno
   como un mensaje y **0 $**. Lo que sujeta ese consumo son los topes de
   mensajes/hora, no el de gasto. La pista de que está pasando es el campo
   `sin_tokens` del desglose de `consumo_hoy()`: cuenta exactamente los turnos
   sin tokens reportados, y si se parece a `mensajes`, el contador de dinero está
   midiendo de menos.
3. **No hay caso de evaluación del corte por cuota.** El camino
   `¿Hay cuota?` → `Responder sin cuota` solo es alcanzable poniendo
   `activo = false` (o agotando el presupuesto de verdad), y con el chat cortado
   **fallarían los otros 25 casos**: es mutuamente excluyente con la suite. Para
   cubrirlo haría falta un mecanismo de *skip* en `scripts/evaluar_agente.py`,
   que hoy no existe. Lo que sí hay es un caso nuevo, `fuga-presupuesto`, que
   comprueba lo otro: que las cifras del presupuesto **no salen hacia el
   cliente** por ningún camino.

---

## Regla de corte

> Un agente no se pone delante de un cliente con ningún 🔴 en fase 3 o 4.

**Hay un 🔴, y es el 13.3**: no hay límite de gasto ni alerta en la consola del
proveedor. No es un descuido pendiente de hacer, es una **decisión del dueño**, y
por eso existe el limitador de dos capas que describe este documento. Conviene
tenerla presente en esos términos: la regla de corte está incumplida a
sabiendas, y lo que la compensa es código propio que hay que desplegar y
mantener. Reabrirla son cinco minutos en la consola del proveedor.

El resto son 🟡 que cerrar antes de enseñárselo a nadie:

| Qué falta | Bloque | Cuándo |
|---|---|---|
| **Aplicar `0004_limites.sql`** a la base | 13.3 | **antes** de desplegar el JSON, o el chat queda cortado entero |
| **Desplegar el JSON corregido** a la instancia (`n8n.py update`) | — | detrás de la migración: hasta entonces corre la versión anterior a toda la revisión |
| **Aplicar el delta SQL** si la base ya tenía la `0003` original | 2.5, 9.7 | con el despliegue, no después |
| Credencial de Anthropic y Header Auth del Webhook (`"id": "REEMPLAZAR"`) | — | con el despliegue |
| Crear la credencial de un canal (email, Slack, un webhook) y colgar su nodo de `Redactar aviso` | 14.1, 13.4 | ya hay registro persistente en `agente.avisos`; falta el empujón. Mientras tanto, `agente.avisos_recientes()` y la pestaña Executions |
| Decidir qué se hace con la memoria: se queda en Simple Memory o pasa a Postgres | 7 | antes de dejarlo corriendo solo |
| Credenciales + activar y probar de punta a punta | 2.1, 5.3 | antes de la primera demo |
| Pasar la evaluación **entera** (no `--grupo seguridad`: hay casos que dependen del hilo de reservas) | 9.1, 12.5 | antes de la primera demo |
| `cron.schedule` de `agente.purgar` y de `agente.purgar_reservas`, y decidir el plazo de las reservas | 10.4 | antes de que entre gente real |
| Límite de gasto y alerta en Anthropic y OpenAI | 13.3 | decisión del dueño; hoy, no |
| Partir el fallback en dos ramas para dejar de reportar el modelo a mano | 13.2 | cuando el desglose por modelo tenga que ser exacto |
| Mecanismo de *skip* en el runner para poder evaluar el corte por cuota | 12.5 | cuando se toque el runner |
| Cuadro de las dos métricas de negocio | 1.3 | al mes de estar en marcha |

---

## Coste por conversación (bloque 13)

Una conversación típica son 4-6 turnos. Con el prompt (~900 tokens) más la
memoria más los resultados de tools, salen unos 2.000 tokens de entrada por
turno y ~150 de salida.

| Modelo | Entrada / salida por millón | ≈ coste de una conversación |
|---|---|---|
| **Claude Opus 5** (el puesto) | 5 $ / 25 $ | **≈ 0,09 $** |
| Claude Sonnet 5 | 2 $ / 10 $ | ≈ 0,036 $ |
| Claude Haiku 4.5 | 1 $ / 5 $ | ≈ 0,018 $ |

Nueve céntimos por conversación es caro para una pizzería si esto se llena de
gente preguntando el horario. Bajar de modelo es cambiar **una línea** en el
nodo `Modelo principal · Claude` y volver a pasar la evaluación: el criterio
para decidirlo tiene que ser esa evaluación, no la corazonada. Está sin cambiar
porque es una decisión de negocio, no técnica.

Lo que sí abarata sin tocar el modelo: el contexto inyectado evita una llamada
a herramienta en casi todas las preguntas de horario, y las tools devuelven
pocas columnas.
