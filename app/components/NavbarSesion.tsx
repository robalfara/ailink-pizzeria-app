import Link from "next/link";

import { cerrarSesion } from "../(auth)/acciones";
import { obtenerUsuario } from "@/lib/dal";

/**
 * Estado de sesión de la Navbar.
 *
 * Va separado del componente Navbar y envuelto en <Suspense> desde allí: es lo
 * único que necesita leer cookies, y aislarlo permite que el resto de la
 * cabecera se envíe al navegador sin esperar a la validación del token.
 */
export default async function NavbarSesion() {
  const usuario = await obtenerUsuario();

  // Sin sesión, un enlace de texto y no un botón: el botón de la cabecera es
  // "Pedir ahora", que es lo que da dinero. Registrarse es secundario.
  if (!usuario) {
    return (
      <Link
        href="/login"
        className="text-sm font-medium text-charcoal/70 transition-colors hover:text-tomato"
      >
        Entrar
      </Link>
    );
  }

  const nombre =
    (usuario.user_metadata?.nombre as string | undefined) ?? "tu cuenta";

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
