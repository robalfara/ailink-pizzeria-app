/**
 * Campo de formulario con etiqueta y error.
 *
 * El error se asocia al input con `aria-describedby` y `aria-invalid` para que
 * un lector de pantalla lo anuncie, en vez de dejarlo como texto rojo suelto
 * que solo existe para quien ve la pantalla.
 */
export function Campo({
  id,
  etiqueta,
  errores,
  ...props
}: {
  id: string;
  etiqueta: string;
  errores?: string[];
} & React.InputHTMLAttributes<HTMLInputElement>) {
  const idError = `${id}-error`;
  const tieneError = Boolean(errores?.length);

  return (
    <div className="space-y-1.5">
      <label
        htmlFor={id}
        className="block text-sm font-medium text-charcoal/80"
      >
        {etiqueta}
      </label>

      <input
        id={id}
        name={id}
        aria-invalid={tieneError}
        aria-describedby={tieneError ? idError : undefined}
        className={`w-full rounded-lg border bg-cream-deep/40 px-3 py-2 text-charcoal outline-none transition-colors placeholder:text-charcoal/35 focus:border-tomato focus:bg-cream ${
          tieneError ? "border-tomato" : "border-charcoal/15"
        }`}
        {...props}
      />

      {tieneError && (
        <p id={idError} className="text-sm text-tomato">
          {errores?.join(" ")}
        </p>
      )}
    </div>
  );
}

/** Aviso general del formulario: error de credenciales o alta correcta. */
export function Aviso({
  children,
  tono = "error",
}: {
  children: React.ReactNode;
  tono?: "error" | "exito";
}) {
  const estilos =
    tono === "exito"
      ? "border-basil/30 bg-basil/10 text-basil"
      : "border-tomato/30 bg-tomato/10 text-tomato";

  return (
    <p
      role="status"
      className={`rounded-lg border px-3 py-2 text-sm ${estilos}`}
    >
      {children}
    </p>
  );
}

export function BotonEnviar({
  pendiente,
  children,
}: {
  pendiente: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={pendiente}
      className="w-full rounded-full bg-tomato px-5 py-2.5 text-sm font-semibold text-cream shadow-sm transition-colors hover:bg-tomato-dark disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pendiente ? "Un momento…" : children}
    </button>
  );
}
