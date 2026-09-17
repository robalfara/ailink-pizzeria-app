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

/**
 * Ficha mínima del cliente en sesión, o null si no hay sesión.
 *
 * Se llamaba `obtenerFichaParaAgente` porque nació para el chat, pero tiene dos
 * consumidores y el nombre escondía uno: el agente conversacional y la Navbar,
 * que saluda por el nombre. Que los dos lean de aquí es justamente el punto
 * (ver abajo).
 *
 * A diferencia de `obtenerPerfil()`, esta NO redirige: el chat lo puede usar
 * cualquiera, con cuenta o sin ella, y quedarse sin ficha es un caso normal y
 * no un error.
 *
 * Cinco campos y ni uno más (bloque 3.7 del checklist): esto viaja a n8n y
 * queda escrito en la ejecución del workflow. Volcar la fila entera del
 * cliente sería caro, despistaría al agente y dejaría datos en un sitio donde
 * no hacen falta.
 */
export const obtenerFichaCliente = cache(async () => {
  const user = await obtenerUsuario();

  if (!user) return null;

  const supabase = await crearClienteServidor();

  const { data, error } = await supabase
    .from("profiles")
    .select("nombre, telefono")
    .eq("id", user.id)
    .single();

  // El error se descartaba al desestructurar, y eso hacía indistinguibles dos
  // cosas muy distintas: "este cliente no ha puesto teléfono" y "la query se ha
  // caído". Con RLS mal puesta, la red partida o el pool agotado, un cliente
  // identificado pasaba a ser tratado como anónimo por el agente y no quedaba
  // ni una línea en el log. Se sigue degradando sin lanzar —eso es lo correcto
  // para el chat—, pero ahora deja rastro.
  //
  // Ni email ni teléfono en el log: son datos personales y un log se copia, se
  // exporta y se comparte en un ticket. Con el userId ya se identifica la fila.
  if (error) {
    console.error("[dal] no se pudo leer el perfil del cliente:", {
      userId: user.id,
      code: error.code,
      message: error.message,
    });
  }

  return {
    id: user.id,
    nombre: data?.nombre ?? "",
    telefono: data?.telefono ?? "",
    email: user.email ?? "",
  };
});

/**
 * Escritura del perfil. La otra mitad de la barrera.
 *
 * Vivía en `app/cuenta/acciones.ts`, que conocía el nombre de la tabla y de sus
 * columnas desde fuera de `lib/`. La barrera quedaba asimétrica —las lecturas
 * pasaban por aquí, las escrituras no— y eso es lo que dejó que durante un
 * tiempo se escribiera en `profiles` mientras la Navbar leía de
 * `user_metadata`: dos sitios que nadie comparaba porque estaban en capas
 * distintas.
 *
 * No lleva `cache()`: memoizar una escritura sería un error, no una
 * optimización.
 */
export async function guardarPerfil(datos: {
  nombre: string;
  telefono: string;
}) {
  // La sesión se comprueba aquí y no se hereda de quien llame: esta función es
  // la barrera, y una barrera que confía en que ya te miraron no es barrera.
  const { userId } = await verificarSesion();
  const supabase = await crearClienteServidor();

  // El id nunca sale del formulario: sale de la sesión. Si viniera del cliente,
  // cualquiera podría editar el perfil de otro cambiando un campo oculto. RLS
  // lo impediría igualmente, pero esa es la segunda barrera, no la primera.
  const { error } = await supabase
    .from("profiles")
    .update({
      nombre: datos.nombre,
      telefono: datos.telefono || null,
    })
    .eq("id", userId);

  if (error) {
    console.error("[dal] no se pudo guardar el perfil:", {
      userId,
      code: error.code,
      message: error.message,
    });
    return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// La carta
// ---------------------------------------------------------------------------

export type PlatoCarta = {
  id: number;
  nombre: string;
  descripcion: string;
  /** Céntimos, entero. Formatear es cosa de la vista. */
  precioCents: number;
  etiquetas: string[];
};

export type CategoriaCarta = {
  id: string;
  titulo: string;
  emoji: string;
  platos: PlatoCarta[];
};

/**
 * La carta, desde la base de datos. Pública: no hay `verificarSesion()`.
 *
 * Existía por duplicado —`lib/data.ts` para la landing, la tabla `platos` para
 * el agente— y aunque plato a plato coincidían, las dos fuentes ya divergían en
 * lo estructural: la columna `disponible` no la veía la landing. Si se acababa
 * la burrata y alguien la marcaba no disponible, el agente dejaba de ofrecerla
 * y la web la seguía anunciando toda la noche.
 *
 * No se filtra por `disponible` a mano, y es a propósito: la policy RLS de
 * `0002_carta.sql` es `using (disponible)`, así que el filtro lo hace Postgres
 * una vez y para todos los que lean la tabla. Un WHERE aquí sería una segunda
 * regla que recordar.
 *
 * Si la query falla se registra y se devuelve una carta vacía en vez de lanzar:
 * la landing es el escaparate del negocio y tumbarla entera por una sección es
 * peor que enseñarla incompleta. El error queda en el log del servidor.
 */
export const obtenerCarta = cache(async (): Promise<CategoriaCarta[]> => {
  const supabase = await crearClienteServidor();

  // Un solo viaje con los platos anidados: PostgREST resuelve la relación por
  // la foreign key. Dos queries y un `group by` en JS harían lo mismo peor.
  const { data, error } = await supabase
    .from("categorias")
    .select(
      "id, titulo, emoji, orden, platos ( id, nombre, descripcion, precio_cents, etiquetas, orden )",
    )
    .order("orden", { ascending: true })
    .order("orden", { referencedTable: "platos", ascending: true });

  if (error) {
    console.error("[dal] no se pudo leer la carta:", {
      code: error.code,
      message: error.message,
    });
    return [];
  }

  // DTO explícito, como en el resto del fichero: el snake_case de la base de
  // datos se queda en la base de datos, y una columna nueva no se filtra sola
  // a la vista.
  return (data ?? []).map((categoria) => ({
    id: categoria.id,
    titulo: categoria.titulo,
    emoji: categoria.emoji,
    platos: (categoria.platos ?? []).map((plato) => ({
      id: plato.id,
      nombre: plato.nombre,
      descripcion: plato.descripcion,
      precioCents: plato.precio_cents,
      etiquetas: plato.etiquetas ?? [],
    })),
  }));
});
