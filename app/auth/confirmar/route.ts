import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";

import { crearClienteServidor } from "@/lib/supabase/server";
import { destinoSeguro } from "@/lib/validacion";
import type { EmailOtpType } from "@supabase/supabase-js";

/**
 * Aterrizaje del enlace de confirmación de email.
 *
 * Va en un Route Handler y no en una página porque aquí SÍ se pueden emitir
 * cookies: es donde se materializa la sesión. Un Server Component no puede
 * (ver el try/catch de lib/supabase/server.ts).
 *
 * Se aceptan las dos formas en que Supabase puede devolver al usuario, que
 * dependen de la plantilla de email configurada en el dashboard:
 *
 *  - `?code=…`                  flujo PKCE, es lo que manda la plantilla por
 *                               defecto ({{ .ConfirmationURL }}).
 *  - `?token_hash=…&type=…`     si la plantilla se cambia a {{ .TokenHash }},
 *                               que es lo que recomienda Supabase para SSR.
 *
 * Soportar ambas evita que cambiar la plantilla rompa el alta, y al revés.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const tipo = searchParams.get("type") as EmailOtpType | null;
  const destino = destinoSeguro(searchParams.get("next"));

  const supabase = await crearClienteServidor();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    // redirect() lanza NEXT_REDIRECT, así que va fuera de cualquier if/try que
    // pudiera tragárselo.
    if (!error) redirect(destino);
  } else if (tokenHash && tipo) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: tipo,
    });
    if (!error) redirect(destino);
  }

  redirect("/login?error=enlace_invalido");
}
