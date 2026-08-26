"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { notificarN8n } from "@/lib/n8n";
import { urlDelSitio } from "@/lib/supabase/config";
import { crearClienteServidor } from "@/lib/supabase/server";
import {
  destinoSeguro,
  validarLogin,
  validarRegistro,
  type EstadoFormulario,
} from "@/lib/validacion";

/**
 * Server Actions de autenticación.
 *
 * Cada action es un endpoint POST público sobre la ruta donde se usa el
 * formulario. Que el formulario solo se pinte en una página concreta no impide
 * que alguien mande el POST a mano: todo lo que llega aquí es no fiable.
 */

export async function iniciarSesion(
  _estado: EstadoFormulario,
  datos: FormData,
): Promise<EstadoFormulario> {
  const validacion = validarLogin(datos);

  if (!validacion.ok) {
    return { errores: validacion.errores, valores: { email: validacion.email } };
  }

  const supabase = await crearClienteServidor();
  const { error } = await supabase.auth.signInWithPassword(validacion.datos);

  if (error) {
    // Mensaje genérico a propósito: distinguir "no existe ese email" de
    // "contraseña incorrecta" permite enumerar quién tiene cuenta.
    return {
      mensaje: "Email o contraseña incorrectos.",
      valores: { email: validacion.datos.email },
    };
  }

  // La Navbar se renderiza en el layout raíz y muestra el estado de sesión:
  // sin esto seguiría pintando "Iniciar sesión" después de entrar.
  revalidatePath("/", "layout");

  // Fuera de cualquier try/catch: redirect() funciona lanzando una excepción
  // (NEXT_REDIRECT). Si se captura, el usuario se queda mirando el formulario
  // con la sesión ya creada.
  redirect(destinoSeguro(datos.get("siguiente")));
}

export async function registrarse(
  _estado: EstadoFormulario,
  datos: FormData,
): Promise<EstadoFormulario> {
  const validacion = validarRegistro(datos);

  if (!validacion.ok) {
    return {
      errores: validacion.errores,
      valores: { nombre: validacion.nombre, email: validacion.email },
    };
  }

  const { nombre, email, password } = validacion.datos;
  const supabase = await crearClienteServidor();

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // Acaba en raw_user_meta_data, de donde lo lee el trigger que crea el
      // perfil. Es un nombre para mostrar: nunca sirve para decidir permisos,
      // porque el propio usuario puede modificarlo.
      data: { nombre },
      emailRedirectTo: `${urlDelSitio()}/auth/confirmar`,
    },
  });

  if (error) {
    // Al usuario se le da un mensaje genérico, pero el motivo real tiene que
    // quedar en el log del servidor: si no, un alta que falla es indepurable.
    console.error("[registro] signUp falló:", {
      status: error.status,
      code: error.code,
      message: error.message,
    });

    return {
      mensaje: "No hemos podido crear la cuenta. Inténtalo de nuevo.",
      valores: { nombre, email },
    };
  }

  // `after()` corre cuando la respuesta ya se ha enviado, así que el usuario no
  // espera a n8n. Es el primer punto de aviso, y es de quita y pon: si el evento
  // que interesa acaba siendo la confirmación y no el alta, esta línea se mueve
  // tal cual a app/auth/confirmar/route.ts.
  after(() => notificarN8n("cliente.registrado", { email, nombre }));

  // Sin redirect: el proyecto exige confirmar el email, así que todavía no hay
  // sesión. Si algún día se desactiva la confirmación, aquí habría que
  // redirigir a /cuenta.
  return {
    exito: true,
    mensaje:
      "Te hemos enviado un email para confirmar la cuenta. Ábrelo y sigue el enlace.",
  };
}

export async function cerrarSesion() {
  const supabase = await crearClienteServidor();
  await supabase.auth.signOut();

  revalidatePath("/", "layout");
  redirect("/");
}
