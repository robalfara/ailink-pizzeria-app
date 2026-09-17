import Link from "next/link";
import { Suspense } from "react";

import NavbarSesion, { SesionSkeleton } from "./NavbarSesion";

// Rutas absolutas con el ancla: desde /login o /cuenta, un "#carta" a secas no
// llevaría a ninguna parte porque esas secciones solo existen en la home.
const links = [
  { href: "/#caracteristicas", label: "Por qué nosotros" },
  { href: "/#carta", label: "Carta" },
  { href: "/#reseñas", label: "Reseñas" },
];

export default function Navbar() {
  return (
    <header className="sticky top-0 z-50 border-b border-charcoal/10 bg-cream/85 backdrop-blur-md">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2">
          <span className="text-2xl" aria-hidden>
            🍕
          </span>
          <span className="font-display text-xl font-extrabold tracking-tight text-charcoal">
            Forno Nostro
          </span>
        </Link>

        <ul className="hidden items-center gap-8 text-sm font-medium text-charcoal/70 md:flex">
          {links.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="transition-colors hover:text-tomato"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-4">
          {/* Aislado en Suspense: es la única parte que lee cookies, así que el
              resto de la cabecera puede enviarse sin esperar a validar el token
              contra el servidor de Auth. */}
          <Suspense fallback={<SesionSkeleton />}>
            <NavbarSesion />
          </Suspense>

          {/* El CTA principal sigue siendo pedir, no registrarse. */}
          <Link
            href="/#carta"
            className="rounded-full bg-tomato px-5 py-2 text-sm font-semibold text-cream shadow-sm transition-colors hover:bg-tomato-dark"
          >
            Pedir ahora
          </Link>
        </div>
      </nav>
    </header>
  );
}
