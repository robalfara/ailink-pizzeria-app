import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";

import { crearClienteServidor } from "./supabase/server";

/**
 * Data Access Layer.
 *
 * Es la barrera de seguridad real: el proxy solo hace una comprobación
 * optimista, y los layouts no sirven porque con Partial Rendering no se
 * vuelven a renderizar al navegar entre rutas hijas. Toda lectura de datos de
 * usuario pasa por aquí.
 *
 * Ver node_modules/next/dist/docs/01-app/02-guides/authentication.md
 *
 * `cache()` de React memoiza por pasada de render: la Navbar, la página y una
 * Server Action pueden pedir el usuario sin provocar tres viajes al servidor
 * de Auth.
 */

/** Usuario actual, o null. No redirige: para pintar la Navbar. */
export const obtenerUsuario = cache(async () => {
  const supabase = await crearClienteServidor();

  // getUser() valida el JWT contra el servidor de Auth. getSession() se limita
  // a leer la cookie, así que en servidor no demuestra nada.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user ?? null;
});

/** Exige sesión. Si no la hay, corta el render y manda a /login. */
export const verificarSesion = cache(async () => {
  const user = await obtenerUsuario();

  if (!user) redirect("/login");

  return { userId: user.id, email: user.email ?? "" };
});

export type Perfil = {
  nombre: string;
  telefono: string;
  email: string;
};

/**
 * Perfil del usuario en sesión, como DTO explícito.
 *
 * Se listan las columnas a mano y se devuelve un objeto propio en vez de la
 * fila cruda: así, si mañana la tabla gana una columna interna, no se filtra
 * sola a la vista.
 */
export const obtenerPerfil = cache(async (): Promise<Perfil> => {
  const { userId, email } = await verificarSesion();
  const supabase = await crearClienteServidor();

  const { data, error } = await supabase
    .from("profiles")
    .select("nombre, telefono")
    .eq("id", userId)
    .single();

  if (error) {
    throw new Error(`No se pudo leer el perfil: ${error.message}`);
  }

  return {
    nombre: data.nombre ?? "",
    telefono: data.telefono ?? "",
    email,
  };
});
