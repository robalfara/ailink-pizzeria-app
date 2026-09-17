"use client";

import Link from "next/link";
import { useActionState } from "react";

import { iniciarSesion } from "../acciones";
import { Aviso, BotonEnviar, Campo } from "../Campo";

export default function LoginForm({ siguiente }: { siguiente?: string }) {
  // useActionState, no useFormState: este último quedó deprecado en React 19.
  const [estado, accion, pendiente] = useActionState(iniciarSesion, undefined);

  return (
    <form action={accion} className="space-y-5">
      {/* El destino viaja en el formulario, pero la action no se fía: lo pasa
          por destinoSeguro() para que no pueda apuntar fuera del sitio. */}
      {siguiente && <input type="hidden" name="siguiente" value={siguiente} />}

      {estado?.mensaje && <Aviso>{estado.mensaje}</Aviso>}

      <Campo
        id="email"
        etiqueta="Email"
        type="email"
        autoComplete="email"
        placeholder="tu@email.com"
        defaultValue={estado?.valores?.email}
        errores={estado?.errores?.email}
        required
      />

      <Campo
        id="password"
        etiqueta="Contraseña"
        type="password"
        autoComplete="current-password"
        errores={estado?.errores?.password}
        required
      />

      <BotonEnviar pendiente={pendiente}>Entrar</BotonEnviar>

      <p className="text-center text-sm text-charcoal/60">
        ¿Todavía no tienes cuenta?{" "}
        <Link
          href="/registro"
          className="font-medium text-tomato hover:underline"
        >
          Crear una
        </Link>
      </p>
    </form>
  );
}
