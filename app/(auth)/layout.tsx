import Link from "next/link";

/**
 * Layout de las pantallas de acceso.
 *
 * El grupo `(auth)` no aparece en la URL: las rutas siguen siendo /login y
 * /registro. Aquí no hay Navbar ni Footer a propósito, para no ofrecer salidas
 * en mitad del alta más allá del logo.
 */
export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <main className="bg-paper flex min-h-screen flex-col items-center justify-center px-6 py-12">
      <Link href="/" className="mb-8 flex items-center gap-2">
        <span className="text-3xl" aria-hidden>
          🍕
        </span>
        <span className="font-display text-2xl font-extrabold tracking-tight text-charcoal">
          Forno Nostro
        </span>
      </Link>

      <div className="w-full max-w-md rounded-2xl border border-charcoal/10 bg-cream p-8 shadow-sm">
        {children}
      </div>

      <Link
        href="/"
        className="mt-8 text-sm text-charcoal/60 transition-colors hover:text-tomato"
      >
        ← Volver a la carta
      </Link>
    </main>
  );
}
