"use server";

import { revalidatePath } from "next/cache";

import { guardarPerfil } from "@/lib/dal";
import { validarPerfil, type EstadoFormulario } from "@/lib/validacion";

export async function actualizarPerfil(
  _estado: EstadoFormulario,
  datos: FormData,
): Promise<EstadoFormulario> {
  const validacion = validarPerfil(datos);
  if (!validacion.ok) return { errores: validacion.errores };

  // La sesión se comprueba dentro de `guardarPerfil()`, no aquí: la escritura
  // vivía en esta action, que conocía el nombre de la tabla y de sus columnas
  // desde fuera de `lib/`. Con las lecturas pasando por la DAL y las escrituras
  // no, la barrera quedaba a medias y nadie comparaba las dos mitades. Ahora la
  // action solo orquesta: validar, escribir por la DAL y revalidar.
  //
  // Sigue siendo un POST público sobre /cuenta que se puede invocar sin haber
  // pasado por la página; quien lo haga sin sesión acaba en /login, porque
  // `guardarPerfil()` llama a `verificarSesion()` por su cuenta.
  const guardado = await guardarPerfil(validacion.datos);

  if (!guardado) {
    return { mensaje: "No hemos podido guardar los cambios." };
  }

  revalidatePath("/cuenta");
  // La Navbar saluda por el nombre y lo lee de `profiles`, que es justo lo que
  // se acaba de escribir: sin invalidar el layout, el Router Cache del
  // navegador seguiría sirviendo la cabecera con el nombre viejo al volver a la
  // home. (Este comentario decía lo mismo cuando NO era verdad: la Navbar leía
  // entonces `user_metadata`, que esta action no toca, así que refrescar no
  // servía de nada y despistaba a quien viniera a investigar el bug.)
  revalidatePath("/", "layout");

  return { exito: true, mensaje: "Datos guardados." };
}
