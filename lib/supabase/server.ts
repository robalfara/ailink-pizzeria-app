import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { configSupabase } from "./config";

/**
 * Cliente de Supabase para Server Components, Server Actions y Route Handlers.
 *
 * Hay que crear uno nuevo en cada render: nunca compartirlo entre peticiones,
 * o se mezclarían sesiones de usuarios distintos.
 */
export async function crearClienteServidor() {
  // `cookies()` es asíncrona desde Next 15 y en 16 el acceso síncrono está
  // eliminado del todo. Ver node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md
  const cookieStore = await cookies();
  const { url, clave } = configSupabase();

  return createServerClient(url, clave, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesAEscribir) {
        try {
          for (const { name, value, options } of cookiesAEscribir) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Renderizando un Server Component no se pueden escribir cookies:
          // HTTP no admite Set-Cookie una vez empezado el streaming. No es un
          // error recuperable aquí, y tampoco hace falta que lo sea: el
          // refresco del token lo hace proxy.ts en cada petición, que sí puede
          // escribir en la respuesta.
        }
      },
    },
  });
}
