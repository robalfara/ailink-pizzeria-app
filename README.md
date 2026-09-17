# Forno Nostro

Landing de pizzería con área de cliente. Next.js 16 (App Router) y Supabase.

## Puesta en marcha

```bash
npm ci
cp .env.example .env.local   # y rellenarlo
npm run dev
```

Hacen falta además dos cosas en el proyecto de Supabase:

1. **Esquema.** Ejecutar `supabase/migrations/0001_profiles.sql` en el SQL Editor
   del dashboard. Crea la tabla `profiles`, sus políticas de RLS y el trigger que
   da de alta el perfil al registrarse.
2. **URLs de auth.** En Authentication → URL Configuration, añadir la URL local
   (`http://localhost:3000/**`) a *Redirect URLs*. Sin esto, el enlace del email
   de confirmación no vuelve a la aplicación.

> Si el puerto 3000 está ocupado, Next arranca en el 3001 y `NEXT_PUBLIC_SITE_URL`
> tiene que apuntar al puerto real, o los emails de confirmación llevarán a un
> sitio donde no hay nada escuchando.

## Cómo funciona el login

- Registro y login son **Server Actions** (`app/(auth)/acciones.ts`).
- La sesión vive en **cookies `httpOnly`** que gestiona `@supabase/ssr`, y la
  refresca `proxy.ts` en cada petición.
- Quien decide si hay sesión es **`lib/dal.ts`**, lo más cerca posible del dato.
  El redirect del proxy es solo una comprobación optimista para no pintar
  pantallas inútiles.
- El alta exige **confirmar el email**: tras registrarse todavía no hay sesión
  hasta que se abre el enlace, que aterriza en `app/auth/confirmar/route.ts`.

## Despliegue

Ya **no** es un sitio estático: `next build` no genera `out/`. Necesita un runtime
Node (`next build` + `next start`, o Docker con `output: "standalone"`).

Al desplegar hay que recordar:

- Un **build por entorno**: las `NEXT_PUBLIC_*` se incrustan en el bundle durante
  el build, no se leen en runtime.
- `NEXT_PUBLIC_SITE_URL` con el dominio real, y ese dominio dado de alta en las
  Redirect URLs del dashboard.
- Si hay varias instancias detrás de un balanceador, fijar
  `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` para que las Server Actions no fallen al
  saltar de instancia.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Build de producción |
| `npm run start` | Sirve el build |
| `npm run lint` | ESLint |
| `npx tsc --noEmit` | Comprobación de tipos |

Más detalle y los caveats del stack, en [`AGENTS.md`](./AGENTS.md).
