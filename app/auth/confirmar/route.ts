import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";

import { crearClienteServidor } from "@/lib/supabase/server";
import { destinoSeguro } from "@/lib/validacion";

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

/**
 * Los tipos de OTP por email que Supabase admite.
 *
 * Aquí había un `as EmailOtpType`, y era una aserción que mentía: ese tipo
 * incluye `(string & {})`, así que el `as` no comprobaba nada y cualquier
 * `?type=loquesea` viajaba tal cual hasta `verifyOtp`. Una lista explícita
 * convierte el parámetro en lo que decía ser.
 */
const TIPOS_OTP = [
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
] as const;

type TipoOtp = (typeof TIPOS_OTP)[number];

function esTipoOtp(valor: string): valor is TipoOtp {
  return TIPOS_OTP.some((tipo) => tipo === valor);
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const tipoCrudo = searchParams.get("type");
  const tipo: TipoOtp | null =
    tipoCrudo && esTipoOtp(tipoCrudo) ? tipoCrudo : null;
  const destino = destinoSeguro(searchParams.get("next"));

  const supabase = await crearClienteServidor();

  // Ni `code` ni `token_hash` se registran nunca: son credenciales de un solo
  // uso, y un log es un sitio del que se hacen copias. Se registra por qué
  // falló, que es lo que hacía falta y no había.
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    // redirect() lanza NEXT_REDIRECT, así que va fuera de cualquier if/try que
    // pudiera tragárselo.
    if (!error) redirect(destino);

    // Sin esto, "el enlace no me funciona" era indepurable: no se sabía si
    // había caducado, si ya se había consumido, si el code_verifier no cuadraba
    // o si alguien había cambiado la plantilla en el dashboard.
    console.error("[confirmar] exchangeCodeForSession falló:", {
      status: error.status,
      code: error.code,
      message: error.message,
    });
  } else if (tokenHash && tipo) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: tipo,
    });
    if (!error) redirect(destino);

    console.error("[confirmar] verifyOtp falló:", {
      tipo,
      status: error.status,
      code: error.code,
      message: error.message,
    });
  } else {
    // El tercer motivo de fallo, y el más silencioso: el enlace llega sin nada
    // que canjear, o con un `type` que no existe. Casi siempre es la plantilla
    // del dashboard, no el usuario.
    console.error("[confirmar] enlace sin parámetros utilizables:", {
      tieneTokenHash: Boolean(tokenHash),
      // Recortado: es entrada del usuario y va a un log.
      tipoCrudo: tipoCrudo?.slice(0, 32) ?? null,
    });
  }

  redirect("/login?error=enlace_invalido");
}
