/**
 * Lectura de la configuración de Supabase.
 *
 * Se comprueba en cada llamada y no en el import: así un despliegue mal
 * configurado falla con un mensaje legible en la petición, en vez de romper
 * el arranque con un `undefined` a cien líneas de distancia.
 */
export function configSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const clave = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !clave) {
    throw new Error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
        "Copia .env.example a .env.local y rellénalas.",
    );
  }

  return { url, clave };
}

/**
 * Base para los enlaces que Supabase manda por email (confirmación de alta).
 * Sin barra final: se le concatenan rutas absolutas.
 */
export function urlDelSitio() {
  const url = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  return url.replace(/\/+$/, "");
}
