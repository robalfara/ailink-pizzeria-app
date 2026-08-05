"use client";

import Link from "next/link";
import { useActionState } from "react";

import { registrarse } from "../acciones";
import { Aviso, BotonEnviar, Campo } from "../Campo";

export default function RegistroForm() {
  const [estado, accion, pendiente] = useActionState(registrarse, undefined);

  // Alta correcta: no hay sesión todavía porque falta confirmar el email, así
  // que se sustituye el formulario en vez de dejarlo ahí invitando a reenviar.
  if (estado?.exito) {
    return (
      <div className="space-y-5">
        <Aviso tono="exito">{estado.mensaje}</Aviso>
        <p className="text-sm text-charcoal/60">
          Revisa también la carpeta de spam. El enlace caduca, así que mejor
          ábrelo pronto.
        </p>
        <Link
          href="/login"
          className="block text-center text-sm font-medium text-tomato hover:underline"
        >
          Ir a entrar
        </Link>
      </div>
    );
  }

  return (
    <form action={accion} className="space-y-5">
      {estado?.mensaje && <Aviso>{estado.mensaje}</Aviso>}

      <Campo
        id="nombre"
        etiqueta="Nombre"
        type="text"
        autoComplete="given-name"
        placeholder="Cómo quieres que te llamemos"
        defaultValue={estado?.valores?.nombre}
        errores={estado?.errores?.nombre}
        required
      />

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
        autoComplete="new-password"
        placeholder="Mínimo 8 caracteres"
        errores={estado?.errores?.password}
        required
      />

      <BotonEnviar pendiente={pendiente}>Crear cuenta</BotonEnviar>

      <p className="text-center text-sm text-charcoal/60">
        ¿Ya tienes cuenta?{" "}
        <Link href="/login" className="font-medium text-tomato hover:underline">
          Entrar
        </Link>
      </p>
    </form>
  );
}
