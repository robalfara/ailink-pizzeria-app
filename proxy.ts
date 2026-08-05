import { NextResponse, type NextRequest } from "next/server";

import { actualizarSesion } from "@/lib/supabase/proxy";

/**
 * En Next 16 el middleware pasó a llamarse `proxy` y corre siempre en Node.js;
 * el runtime no es configurable. Ver
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md
 *
 * Aquí se hacen dos cosas: refrescar la sesión de Supabase en cada petición
 * (imprescindible, es el único punto que puede escribir las cookies rotadas) y
 * un redirect OPTIMISTA de las rutas privadas.
 *
 * Optimista quiere decir que NO es la barrera de seguridad. La barrera está en
 * lib/dal.ts, junto al dato. Los docs son explícitos: las Server Functions no
 * son rutas propias, viajan como POST a la ruta donde se usan, así que un
 * matcher que excluya una ruta se salta también sus actions sin avisar.
 */

const RUTAS_PRIVADAS = ["/cuenta"];
const RUTAS_DE_INVITADO = ["/login", "/registro"];

/** Cabeceras anti-caché que pone @supabase/ssr al rotar el token. */
const CABECERAS_A_PROPAGAR = ["cache-control", "expires", "pragma"];

function esRuta(ruta: string, prefijos: string[]) {
  return prefijos.some((p) => ruta === p || ruta.startsWith(`${p}/`));
}

/**
 * Un redirect es una respuesta nueva: si no se le trasplantan las cookies que
 * acaba de escribir Supabase, el token refrescado se pierde y el usuario entra
 * en un bucle de logouts intermitentes.
 */
function redirigirConservandoSesion(destino: URL, origen: NextResponse) {
  const redireccion = NextResponse.redirect(destino);

  for (const cookie of origen.cookies.getAll()) {
    redireccion.cookies.set(cookie);
  }
  for (const cabecera of CABECERAS_A_PROPAGAR) {
    const valor = origen.headers.get(cabecera);
    if (valor) redireccion.headers.set(cabecera, valor);
  }

  return redireccion;
}

export async function proxy(request: NextRequest) {
  const { respuesta, user } = await actualizarSesion(request);
  const ruta = request.nextUrl.pathname;

  if (!user && esRuta(ruta, RUTAS_PRIVADAS)) {
    const destino = request.nextUrl.clone();
    destino.pathname = "/login";
    destino.search = "";
    destino.searchParams.set("siguiente", ruta);
    return redirigirConservandoSesion(destino, respuesta);
  }

  if (user && esRuta(ruta, RUTAS_DE_INVITADO)) {
    const destino = request.nextUrl.clone();
    destino.pathname = "/cuenta";
    destino.search = "";
    return redirigirConservandoSesion(destino, respuesta);
  }

  return respuesta;
}

export const config = {
  /**
   * Solo se excluyen estáticos, ninguna ruta de página.
   *
   * Es deliberado: el logout es una Server Action que vive en la Navbar, o sea
   * en `/`. Si se excluyera `/` del matcher, ese POST dejaría de pasar por aquí
   * y la sesión no se refrescaría, sin ningún error visible.
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
