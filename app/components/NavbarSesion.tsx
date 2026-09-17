import Link from "next/link";

import { cerrarSesion } from "../(auth)/acciones";
import { obtenerFichaCliente } from "@/lib/dal";

/**
 * Estado de sesión de la Navbar.
 *
 * Va separado del componente Navbar y envuelto en <Suspense> desde allí: es lo
 * único que necesita leer cookies, y aislarlo permite que el resto de la
 * cabecera se envíe al navegador sin esperar a la validación del token.
 *
 * Lee de la DAL y no de `user_metadata`, y eso arregla dos cosas a la vez:
 *
 *  1. **El nombre editado en /cuenta ya se ve aquí.** `user_metadata.nombre`
 *     solo lo escribe el `signUp` del registro; la pantalla de cuenta actualiza
 *     la tabla `profiles`. Quien se registraba como "Rob" y se cambiaba a
 *     "Roberto" veía "Datos guardados." y una Navbar que seguía diciendo "Rob"
 *     para siempre. Ahora se lee la misma fuente que se escribe.
 *  2. **Se cae la aserción `as string`.** `user_metadata` lo escribe el propio
 *     usuario con su access token: metiendo un objeto en `nombre`, React
 *     lanzaba «Objects are not valid as a React child» al renderizar esto en el
 *     servidor, y como la Navbar sale en todas las páginas, se llevaba por
 *     delante hasta el botón de "Salir" —el usuario se quedaba sin manera de
 *     escapar del 500—. `profiles.nombre` es una columna `text` y el DTO de la
 *     DAL lo entrega ya como `string`.
 *
 * La ficha va envuelta en `cache()`, así que compartirla con el resto del
 * render (o con la Server Action de la misma pasada) no cuesta un viaje extra.
 */
export default async function NavbarSesion() {
  const ficha = await obtenerFichaCliente();

  // Sin sesión, un enlace de texto y no un botón: el botón de la cabecera es
  // "Pedir ahora", que es lo que da dinero. Registrarse es secundario.
  if (!ficha) {
    return (
      <Link
        href="/login"
        className="text-sm font-medium text-charcoal/70 transition-colors hover:text-tomato"
      >
        Entrar
      </Link>
    );
  }

  // `|| ` y no `?? `: la DAL devuelve cadena vacía cuando el perfil no tiene
  // nombre todavía, y una cabecera con un hueco en blanco no dice nada.
  const nombre = ficha.nombre || "tu cuenta";

  return (
    <div className="flex items-center gap-3">
      <Link
        href="/cuenta"
        className="text-sm font-medium text-charcoal/70 transition-colors hover:text-tomato"
      >
        {nombre}
      </Link>

      {/* Un <form> con Server Action: cerrar sesión modifica estado, así que no
          puede ser un enlace GET (un prefetch del navegador desconectaría al
          usuario). Y al ser un POST sobre /, obliga a que el matcher del proxy
          NO excluya la home. */}
      <form action={cerrarSesion}>
        <button
          type="submit"
          className="rounded-full border border-charcoal/15 px-4 py-2 text-sm font-medium text-charcoal/70 transition-colors hover:border-tomato hover:text-tomato"
        >
          Salir
        </button>
      </form>
    </div>
  );
}

/** Hueco del mismo tamaño para que la cabecera no dé un salto al resolverse. */
export function SesionSkeleton() {
  return (
    <div
      className="h-5 w-14 animate-pulse rounded bg-charcoal/10"
      aria-hidden
    />
  );
}
