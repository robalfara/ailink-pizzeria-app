import "server-only";

/**
 * Cliente del agente conversacional que vive en n8n.
 *
 * Es el hermano *síncrono* de lib/n8n.ts, y las diferencias importan:
 *
 *  - `notificarN8n` avisa y se olvida; aquí la respuesta ES el producto, así
 *    que se espera y se devuelve.
 *  - `notificarN8n` nunca lanza porque un aviso perdido no rompe nada. Aquí
 *    tampoco se lanza, pero por otro motivo: el usuario tiene que ver SIEMPRE
 *    algo en la burbuja del chat (bloque 2.10 del checklist). El silencio es
 *    peor que un error, porque no sabe si esperar o volver a escribir.
 *
 * El secreto y la URL no llevan prefijo NEXT_PUBLIC_: el navegador nunca habla
 * con n8n directamente. Si lo hiciera habría que publicar el secreto, y sería
 * el propio navegador quien dijese qué sesión es la suya.
 */

/**
 * 30 segundos. Un agente que llama a dos o tres herramientas y luego redacta
 * tarda entre 3 y 12; por encima de 30 no es lentitud, es que algo se ha
 * quedado colgado y más vale contestar que seguir esperando.
 */
const TIMEOUT_MS = 30_000;

export type RespuestaAgente = {
  /** Texto que se le enseña al usuario. Nunca vacío. */
  respuesta: string;
  /** `true` cuando esto es un mensaje de cortesía, no una respuesta real. */
  degradado: boolean;
};

const CORTESIA =
  "Ahora mismo no puedo contestarte, perdona. Vuelve a intentarlo en un " +
  "momento o llámanos y te atendemos al vuelo.";

function configAgente() {
  const url = process.env.N8N_AGENTE_URL;
  const secreto = process.env.N8N_AGENTE_SECRET;

  if (!url || !secreto) return null;

  return { url, secreto };
}

/**
 * Si no hay configuración, la app funciona igual y el chat sencillamente no se
 * pinta. Igual que con lib/n8n.ts: en local se levanta el sitio sin tener n8n
 * delante.
 */
export function agenteConfigurado() {
  return configAgente() !== null;
}

// ---------------------------------------------------------------------------
// Lo que este fichero ya NO hace
// ---------------------------------------------------------------------------
// El límite de uso vivía aquí dentro. Se lo llevó `lib/limites.ts`: esto es el
// cliente HTTP del agente y aquello es contabilidad de cuotas, con sus cubos,
// su techo global y su barrido. Quien decide si se llama es
// `app/api/chat/route.ts`; aquí solo se llama.

// ---------------------------------------------------------------------------
// La llamada
// ---------------------------------------------------------------------------

export type FichaCliente = {
  id: string;
  nombre: string;
  telefono: string;
  email: string;
};

export type PreguntaAlAgente = {
  texto: string;
  /**
   * Lo calcula el servidor, NUNCA el navegador. Es la clave de la memoria del
   * agente (bloque 2.11): si viniera del cliente, cualquiera podría escribir
   * la sesión de otro y leerse su conversación.
   */
  sessionId: string;
  /** Clave de idempotencia, ya namespaceada con el sessionId. */
  mensajeId: string;
  /** Solo si hay sesión. Cinco campos, no la fila entera (bloque 3.7). */
  usuario: FichaCliente | null;
};

export async function preguntarAlAgente({
  texto,
  sessionId,
  mensajeId,
  usuario,
}: PreguntaAlAgente): Promise<RespuestaAgente> {
  const config = configAgente();

  if (!config) return { respuesta: CORTESIA, degradado: true };

  try {
    const respuesta = await fetch(config.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Header Auth del Webhook node. Sin esta cabecera la URL del webhook
        // es un endpoint público que cualquiera puede disparar, y encima uno
        // que gasta tokens en cada disparo.
        "x-webhook-secret": config.secreto,
      },
      body: JSON.stringify({ texto, sessionId, mensajeId, usuario }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const cuerpo = (await respuesta.json().catch(() => null)) as {
      ok?: boolean;
      respuesta?: string;
    } | null;

    // n8n contesta 503 con un texto de cortesía dentro cuando el agente falla:
    // el código dice que fue mal, el cuerpo dice qué enseñarle al usuario. Se
    // aprovechan los dos.
    if (!respuesta.ok) {
      console.error("[agente] respuesta con error:", {
        status: respuesta.status,
        sessionId,
      });
      return {
        respuesta: cuerpo?.respuesta || CORTESIA,
        degradado: true,
      };
    }

    const texto_respuesta = cuerpo?.respuesta?.trim();

    if (!texto_respuesta) {
      console.error("[agente] respuesta vacía:", { sessionId });
      return { respuesta: CORTESIA, degradado: true };
    }

    return { respuesta: texto_respuesta, degradado: false };
  } catch (error) {
    console.error("[agente] no se pudo preguntar:", {
      sessionId,
      motivo: error instanceof Error ? error.message : String(error),
    });
    return { respuesta: CORTESIA, degradado: true };
  }
}
