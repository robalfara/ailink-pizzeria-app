import "server-only";

/**
 * Avisos salientes a n8n.
 *
 * La app no expone nada a n8n: es la app quien llama, con un POST a un Webhook
 * node. Eso evita abrir superficie de entrada y deja el control del flujo aquí.
 *
 * Tres decisiones que conviene no deshacer sin pensarlo:
 *
 *  1. La integración es OPCIONAL. Sin las variables de entorno esto es un no-op
 *     silencioso, para que la app siga arrancando en local sin n8n delante.
 *  2. Nunca lanza. Un workflow caído no puede tumbar un alta de cliente: el
 *     error se registra en el log del servidor y la acción sigue su curso.
 *  3. Las variables NO llevan prefijo NEXT_PUBLIC_. El secreto no puede acabar
 *     en el bundle del navegador, y de paso se leen en runtime y no en build.
 */

/** Corte de espera. n8n puede tardar si el workflow es pesado; no le esperamos. */
const TIMEOUT_MS = 5_000;

function configN8n() {
  const url = process.env.N8N_WEBHOOK_URL;
  const secreto = process.env.N8N_WEBHOOK_SECRET;

  if (!url || !secreto) return null;

  return { url, secreto };
}

/**
 * Envía un evento a n8n. Pensado para usarse dentro de `after()`, de modo que
 * el POST ocurre una vez la respuesta ya viajó al navegador.
 *
 * `datos` viaja tal cual: no metas aquí nada que no quieras ver en la ejecución
 * del workflow (contraseñas, tokens de sesión, la fila entera de una tabla).
 */
export async function notificarN8n(
  evento: string,
  datos: Record<string, unknown>,
): Promise<void> {
  const config = configN8n();

  if (!config) return;

  try {
    const respuesta = await fetch(config.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Header Auth del Webhook node. Sin esto la URL del webhook es un
        // endpoint público que cualquiera puede disparar.
        "x-webhook-secret": config.secreto,
      },
      body: JSON.stringify({
        evento,
        datos,
        enviadoEn: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!respuesta.ok) {
      console.error("[n8n] el webhook respondió con error:", {
        evento,
        status: respuesta.status,
        cuerpo: (await respuesta.text()).slice(0, 200),
      });
    }
  } catch (error) {
    console.error("[n8n] no se pudo avisar:", {
      evento,
      motivo: error instanceof Error ? error.message : String(error),
    });
  }
}
