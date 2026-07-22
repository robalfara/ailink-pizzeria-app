import Link from "next/link";

const links = [
  { href: "#caracteristicas", label: "Por qué nosotros" },
  { href: "#carta", label: "Carta" },
  { href: "#reseñas", label: "Reseñas" },
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
              <a
                href={link.href}
                className="transition-colors hover:text-tomato"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>

        <a
          href="#carta"
          className="rounded-full bg-tomato px-5 py-2 text-sm font-semibold text-cream shadow-sm transition-colors hover:bg-tomato-dark"
        >
          Pedir ahora
        </a>
      </nav>
    </header>
  );
}
