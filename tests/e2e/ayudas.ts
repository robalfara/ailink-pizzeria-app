import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { expect, type Page } from "@playwright/test";

/**
 * Utilidades compartidas por las pruebas de punta a punta.
 */

/**
 * Dónde se apuntan los `sessionId` que ha estrenado la corrida.
 *
 * Hace falta porque el `sessionId` NO lo decide el navegador: lo pone
 * `app/api/chat/route.ts` a partir de la cookie `fn_chat` (o de la sesión de
 * Supabase), así que una prueba no puede elegir un prefijo tipo `prueba:` para
 * reconocer luego lo suyo. Lo que sí puede es leer la cookie que le tocó y
 * dejarla escrita aquí, para que `limpieza.ts` borre exactamente esas filas y
 * ni una más.
 */
export const REGISTRO_SESIONES = join(
  process.cwd(),
  "test-results",
  "sesiones-e2e.txt",
);

/**
 * Testigo del interruptor de pánico.
 *
 * `avisos.spec.ts` corta el chat a propósito para comprobar que el corte queda
 * registrado, y eso es global: afecta a todo el mundo mientras dura. El fichero
 * se escribe ANTES de bajar el interruptor y se borra al subirlo, así que su
 * presencia significa «alguien lo bajó y no lo ha vuelto a subir».
 *
 * Vive aquí y no en el spec para que `limpieza.ts` pueda mirarlo sin importar un
 * fichero de pruebas.
 */
export const TESTIGO_PANICO = join(
  process.cwd(),
  "test-results",
  "interruptor-bajado.txt",
);

/**
 * Apunta la sesión de esta prueba para que la limpieza sepa qué borrar.
 *
 * Se llama en un `afterEach`, no al crear el contexto: la cookie no existe
 * hasta que el handler contesta al primer mensaje.
 */
export async function apuntarSesion(page: Page) {
  const cookies = await page.context().cookies();
  const chat = cookies.find((c) => c.name === "fn_chat");

  if (!chat?.value) return;

  mkdirSync(dirname(REGISTRO_SESIONES), { recursive: true });
  appendFileSync(REGISTRO_SESIONES, `a:${chat.value}\n`, "utf8");
}

/**
 * Abre la landing y despliega el widget del chat.
 *
 * El mensaje del `expect` no es decorativo: si falta `N8N_AGENTE_URL` la
 * landing se pinta entera y correcta pero SIN widget, y el fallo por defecto
 * sería un «no encuentro el botón» que manda a buscar en el sitio equivocado.
 */
export async function abrirChat(page: Page) {
  await page.goto("/");

  const boton = page.getByRole("button", { name: "Abrir el chat con Nina" });

  await expect(
    boton,
    "No se pinta el botón del chat. Lo más probable es que falte N8N_AGENTE_URL " +
      "en .env.local: sin ella agenteConfigurado() es false y app/page.tsx no " +
      "monta el widget.",
  ).toBeVisible();

  await boton.click();

  await expect(page.locator("#panel-chat")).toBeVisible();
  await expect(burbujas(page)).toHaveCount(1); // el saludo de Nina
}

/** Todas las burbujas de la conversación, en orden. */
export function burbujas(page: Page) {
  return page.locator('[data-testid="burbuja"]');
}

/**
 * Manda un mensaje y devuelve lo que contesta Nina.
 *
 * Espera a que aparezcan DOS burbujas nuevas (la del cliente y la de Nina) en
 * lugar de mirar el indicador de «escribiendo…». El indicador es un detalle de
 * presentación y podría quitarse mañana; que a un mensaje le siga una respuesta
 * es el contrato.
 *
 * El timeout es largo a propósito: el cliente HTTP de la app corta a los 30 s
 * (`TIMEOUT_MS` en `lib/agente.ts`), así que por debajo de eso esta espera
 * fallaría antes de que la app haya decidido nada.
 */
export async function preguntar(page: Page, texto: string): Promise<string> {
  const antes = await burbujas(page).count();

  await page.locator("#mensaje-chat").fill(texto);
  await page.getByRole("button", { name: "Enviar" }).click();

  await expect(burbujas(page)).toHaveCount(antes + 2, { timeout: 40_000 });

  // Que el campo se desbloquee es la señal de que el ciclo terminó del todo.
  await expect(page.locator("#mensaje-chat")).toBeEnabled({ timeout: 5_000 });

  const respuesta = await burbujas(page).last().innerText();

  // Un fallo del agente se ve como una burbuja de cortesía, no como una
  // excepción, así que hay que mirarlo a mano o la prueba pasaría en verde con
  // el agente caído: exactamente el falso verde que esta suite existe para
  // evitar.
  expect(
    respuesta,
    `Nina ha contestado con el texto de cortesía, o sea que la llamada a n8n ` +
      `falló. Mira el log del servidor (\`[agente]\`) y las ejecuciones del ` +
      `workflow en n8n.\nPregunta: ${texto}`,
  ).not.toContain("Ahora mismo no puedo contestarte");

  return respuesta;
}

// ---------------------------------------------------------------------------
// Hablar con Postgres desde una prueba
// ---------------------------------------------------------------------------

const POOLER = "aws-1-eu-west-1.pooler.supabase.com";
const REF = "kjxxickmrmranqmvgdie";

/**
 * Ejecuta SQL contra la base, como el rol dueño, y devuelve la salida cruda.
 *
 * Por qué `docker` y no una librería: esta máquina no tiene `psql` y añadir un
 * cliente de Postgres a `package.json` para dos consultas de prueba es
 * dependencia nueva en la app para algo que solo usan los tests.
 *
 * **La contraseña no entra nunca en este proceso.** El `grep` de una sola clave
 * vive dentro del comando que ejecuta el contenedor, así que el valor viaja de
 * `.env.local` a la variable de entorno del contenedor sin pasar por aquí. Es la
 * misma convención que el resto del repo: leer una clave, nunca el fichero.
 */
export function sql(consulta: string): string {
  const comando =
    `docker run --rm -i ` +
    `-e PGPASSWORD="$(grep '^SUPABASE_DB_PASSWORD=' .env.local | cut -d= -f2-)" ` +
    `postgres:16-alpine psql ` +
    `"host=${POOLER} port=5432 dbname=postgres user=postgres.${REF} sslmode=require" ` +
    `-At -v ON_ERROR_STOP=1 -c ${JSON.stringify(consulta)}`;

  return execFileSync("bash", ["-c", comando], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 60_000,
  }).trim();
}

/** Un UUID v4 válido, que es lo que exige `validarMensajeChat`. */
export function uuid() {
  return crypto.randomUUID();
}

/**
 * Normaliza para comparar sin pelearse con acentos, mayúsculas ni el espacio
 * fino que mete el formateo de moneda en español (`8,00 €` lleva U+00A0).
 */
export function plano(texto: string) {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ /g, " ")
    .toLowerCase();
}
