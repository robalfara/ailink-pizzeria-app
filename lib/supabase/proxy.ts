import "server-only";

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { configSupabase } from "./config";

/**
 * Refresca la sesión en cada petición y devuelve el usuario ya validado.
 *
 * Se usa desde `proxy.ts` (la raíz del proyecto). Es el único sitio del stack
 * donde se pueden escribir de verdad las cookies rotadas por Supabase, así que
 * si esto no corre, las sesiones caducan y el usuario sufre logouts aleatorios.
 */
export async function actualizarSesion(request: NextRequest) {
  let respuesta = NextResponse.next({ request });
  const { url, clave } = configSupabase();

  const supabase = createServerClient(url, clave, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesAEscribir, cabeceras) {
        // 1) Actualizar la petición, para que el render de aguas abajo lea las
        //    cookies nuevas y no las caducadas.
        for (const { name, value } of cookiesAEscribir) {
          request.cookies.set(name, value);
        }

        // 2) Recrear la respuesta a partir de la petición ya actualizada.
        //    Saltarse este paso es la causa de las sesiones "fantasma" que
        //    aparecen y desaparecen entre navegaciones.
        respuesta = NextResponse.next({ request });

        // 3) Escribir las cookies en la respuesta que sale hacia el navegador.
        for (const { name, value, options } of cookiesAEscribir) {
          respuesta.cookies.set(name, value, options);
        }

        // 4) Cabeceras anti-caché que envía la propia librería
        //    (Cache-Control: private, no-store...). Sin ellas, un CDN o un
        //    nginx con caché puede guardar una respuesta que lleva el
        //    Set-Cookie de la sesión y servírsela a OTRO usuario.
        for (const [nombre, valor] of Object.entries(cabeceras)) {
          respuesta.headers.set(nombre, valor);
        }
      },
    },
  });

  // getUser() y no getSession(): getSession() se fía de la cookie sin
  // revalidar el JWT contra el servidor de Auth, así que en servidor no
  // demuestra nada. Además hay que llamarlo pronto: si el refresco termina
  // después de haber cerrado la respuesta, el token nuevo se pierde.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { respuesta, user };
}
