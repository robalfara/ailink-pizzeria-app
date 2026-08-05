import type { Metadata } from "next";

import LoginForm from "./LoginForm";

export const metadata: Metadata = {
  title: "Entrar · Forno Nostro",
  robots: { index: false, follow: false },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ siguiente?: string; error?: string }>;
}) {
  // En Next 16 searchParams es una promesa: el acceso síncrono se eliminó.
  const { siguiente, error } = await searchParams;

  return (
    <>
      <h1 className="font-display text-2xl font-bold text-charcoal">
        Entra en tu cuenta
      </h1>
      <p className="mt-1 mb-6 text-sm text-charcoal/60">
        Para ver y editar tus datos de cliente.
      </p>

      {error === "enlace_invalido" && (
        <p
          role="status"
          className="mb-5 rounded-lg border border-crust/40 bg-crust/10 px-3 py-2 text-sm text-crust-dark"
        >
          Ese enlace de confirmación ya no vale. Vuelve a entrar o crea la
          cuenta otra vez.
        </p>
      )}

      <LoginForm siguiente={siguiente} />
    </>
  );
}
