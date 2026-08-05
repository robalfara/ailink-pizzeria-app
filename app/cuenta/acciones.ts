"use server";

import { revalidatePath } from "next/cache";

import { verificarSesion } from "@/lib/dal";
import { crearClienteServidor } from "@/lib/supabase/server";
import { validarPerfil, type EstadoFormulario } from "@/lib/validacion";

export async function actualizarPerfil(
  _estado: EstadoFormulario,
  datos: FormData,
): Promise<EstadoFormulario> {
  // Se vuelve a comprobar la sesión aquí, no se hereda del render de la
  // página: esta action es un POST público sobre /cuenta y podría invocarse
  // sin haber pasado por ella. Los docs de Next lo dicen explícitamente para
  // las Server Functions.
  const { userId } = await verificarSesion();

  const validacion = validarPerfil(datos);
  if (!validacion.ok) return { errores: validacion.errores };

  const supabase = await crearClienteServidor();

  // Nunca se toma el id de formData: sale de la sesión. Si viniera del cliente,
  // cualquiera podría editar el perfil de otro cambiando un campo oculto.
  // RLS lo impediría igualmente, pero esa es la segunda barrera, no la primera.
  const { error } = await supabase
    .from("profiles")
    .update({
      nombre: validacion.datos.nombre,
      telefono: validacion.datos.telefono || null,
    })
    .eq("id", userId);

  if (error) {
    return { mensaje: "No hemos podido guardar los cambios." };
  }

  revalidatePath("/cuenta");
  // La Navbar saluda por el nombre, así que también hay que refrescarla.
  revalidatePath("/", "layout");

  return { exito: true, mensaje: "Datos guardados." };
}
