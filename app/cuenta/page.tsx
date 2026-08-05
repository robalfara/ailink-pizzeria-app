import type { Metadata } from "next";

import { obtenerPerfil } from "@/lib/dal";
import PerfilForm from "./PerfilForm";

export const metadata: Metadata = {
  title: "Mi cuenta · Forno Nostro",
  robots: { index: false, follow: false },
};

export default async function CuentaPage() {
  // obtenerPerfil() llama por dentro a verificarSesion(), que corta el render
  // y manda a /login si no hay sesión. Esta es la barrera real; el redirect
  // del proxy solo evita pintar la pantalla para nada.
  const perfil = await obtenerPerfil();

  return (
    <>
      <header className="mb-8">
        <h1 className="font-display text-3xl font-bold text-charcoal">
          {perfil.nombre ? `Hola, ${perfil.nombre}` : "Mi cuenta"}
        </h1>
        <p className="mt-1 text-charcoal/60">
          Tus datos de cliente. Los usaremos para tus pedidos.
        </p>
      </header>

      <section className="rounded-2xl border border-charcoal/10 bg-cream p-8 shadow-sm">
        <PerfilForm perfil={perfil} />
      </section>

      <section className="mt-6 rounded-2xl border border-dashed border-charcoal/15 p-6">
        <h2 className="font-display text-lg font-semibold text-charcoal/70">
          Tus pedidos
        </h2>
        <p className="mt-1 text-sm text-charcoal/50">
          Todavía no se pueden hacer pedidos online. Llámanos y te los
          preparamos.
        </p>
      </section>
    </>
  );
}
