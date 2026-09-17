"use client";

import { useActionState } from "react";

import { Aviso, BotonEnviar, Campo } from "../(auth)/Campo";
import { actualizarPerfil } from "./acciones";
import type { Perfil } from "@/lib/dal";

export default function PerfilForm({ perfil }: { perfil: Perfil }) {
  const [estado, accion, pendiente] = useActionState(
    actualizarPerfil,
    undefined,
  );

  return (
    <form action={accion} className="space-y-5">
      {estado?.mensaje && (
        <Aviso tono={estado.exito ? "exito" : "error"}>{estado.mensaje}</Aviso>
      )}

      <Campo
        id="nombre"
        etiqueta="Nombre"
        type="text"
        autoComplete="given-name"
        defaultValue={perfil.nombre}
        errores={estado?.errores?.nombre}
        required
      />

      <Campo
        id="telefono"
        etiqueta="Teléfono"
        type="tel"
        autoComplete="tel"
        placeholder="Para avisarte cuando esté listo el pedido"
        defaultValue={perfil.telefono}
      />

      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-charcoal/80">
          Email
        </label>
        <p className="rounded-lg border border-charcoal/10 bg-cream-deep/30 px-3 py-2 text-charcoal/60">
          {perfil.email}
        </p>
        <p className="text-xs text-charcoal/50">
          El email identifica tu cuenta y no se puede cambiar desde aquí.
        </p>
      </div>

      <BotonEnviar pendiente={pendiente}>Guardar cambios</BotonEnviar>
    </form>
  );
}
