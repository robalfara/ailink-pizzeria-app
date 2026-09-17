import type { Metadata } from "next";

import RegistroForm from "./RegistroForm";

export const metadata: Metadata = {
  title: "Crear cuenta · Forno Nostro",
  robots: { index: false, follow: false },
};

export default function RegistroPage() {
  return (
    <>
      <h1 className="font-display text-2xl font-bold text-charcoal">
        Crea tu cuenta
      </h1>
      <p className="mt-1 mb-6 text-sm text-charcoal/60">
        Guarda tus datos y ten tus pedidos más a mano.
      </p>

      <RegistroForm />
    </>
  );
}
