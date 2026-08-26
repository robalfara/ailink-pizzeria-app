<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# ailink-pizzeria-app

Landing de la pizzería **Forno Nostro** con área de cliente.

## Stack

- **Next.js 16.2.11** (App Router) · React 19 · TypeScript strict
- **Tailwind v4**, configuración CSS-first: el tema vive en el bloque `@theme` de
  `app/globals.css`, **no hay `tailwind.config`**
- **Supabase**: Auth (email + contraseña, con confirmación) y Postgres con RLS
- Sin tests ni CI hoy

## Comandos

```bash
npm ci                  # instalar (no npm install: respeta el lockfile)
npm run dev             # desarrollo — ojo, si el 3000 está ocupado se va al 3001
npm run build           # producción
npm run lint
npx tsc --noEmit        # tipos
npx next typegen        # regenerar tipos de rutas si tsc se queja de .next/dev/types
```

## Puesta en marcha

1. `npm ci`
2. Copiar `.env.example` a `.env.local` y rellenarlo (ver notas del propio fichero).
3. Aplicar `supabase/migrations/0001_profiles.sql` desde el SQL Editor del dashboard.
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
- `lib/data.ts` sigue teniendo la carta hardcodeada, con precios como texto
  (`"9,50 €"`). Al moverla a la base de datos habrá que pasarlos a enteros.

## n8n

Dos integraciones con propósitos opuestos; no confundirlas.

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

- El plugin **también trae un MCP** (`n8n-mcp` → `<n8n_url>/mcp-server/http`).
  Su `n8n_url` se deja **a propósito sin configurar**: sin valor el servidor no
  se registra. La gestión de la instancia ya la hace `scripts/n8n.py` y no
  interesa un tercer camino a n8n con sus propias credenciales. Si algún día se
  quiere: `/plugin configure n8n-skills@n8n-io`.
- Las skills se cargan al **arrancar la sesión**: tras instalar hace falta
  `/reload-plugins` o abrir una sesión nueva.

### Skill propia — diseñar y auditar agentes

`.claude/skills/agente-n8n/`, versionada en el repo. Destila el checklist
*Anatomía de un agente en n8n* (Ailink, v2) en un procedimiento: test de la
pizarra (¿agente o workflow?), las cuatro fases en orden, la regla de corte
—ningún 🔴 en seguridad ni operación delante de un cliente— y una tabla de
síntoma → bloque. Las fases viven en `references/` y se cargan de una en una.

Cubre el **criterio**; el **cómo** en n8n lo cubren las `n8n-*-official`. Los
puntos conservan la numeración del checklist (`2.11`, `6.3`) para poder citarlos
contra el entregable original.

## Estructura

```
app/
├── (auth)/            # /login y /registro (el grupo no sale en la URL)
├── auth/confirmar/    # route handler del enlace de confirmación
├── cuenta/            # área de cliente
└── components/        # Navbar, Hero, Menu, Reviews, Footer...
lib/
├── dal.ts             # data access layer: la barrera de auth
├── supabase/          # clientes de servidor y de proxy
├── validacion.ts      # validación de formularios y destinoSeguro()
├── n8n.ts             # aviso saliente a n8n (opcional, nunca lanza)
└── data.ts            # carta y reseñas hardcodeadas
proxy.ts               # refresco de sesión (antes middleware.ts)
scripts/n8n.py         # cliente de la Public API de n8n
.claude/skills/        # agente-n8n/ es nuestra; el resto, enlaces a .agents/skills/
supabase/migrations/   # SQL, fuente de verdad del esquema
```
