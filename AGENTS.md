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
└── data.ts            # carta y reseñas hardcodeadas
proxy.ts               # refresco de sesión (antes middleware.ts)
supabase/migrations/   # SQL, fuente de verdad del esquema
```
