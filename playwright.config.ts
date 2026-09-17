import { defineConfig, devices } from "@playwright/test";

/**
 * Configuración de las pruebas de punta a punta.
 *
 * Estas pruebas NO son unitarias y no hay mocks en ningún sitio: hablan con el
 * n8n de verdad, que habla con el Supabase de verdad y gasta tokens de verdad.
 * Eso es deliberado —lo que se quiere comprobar es justo la fontanería entre
 * las tres cosas— pero condiciona toda la configuración de este fichero.
 *
 * Por qué cada decisión rara es la que es:
 *
 *  - **Un solo worker y nada en paralelo.** `lib/limites.ts` tiene techos
 *    globales por proceso (30/min y 400/h) y el backstop de Postgres tiene los
 *    suyos (300/h global, 40/h por sesión). Dos workers a la vez se pisan esos
 *    contadores y empiezan a salir 429 que no son un fallo del código, son un
 *    fallo del arnés. En serie, además, el orden es reproducible.
 *
 *  - **Sin reintentos.** Un reintento en una prueba que habla con un LLM no es
 *    gratis: vuelve a gastar tokens y vuelve a escribir en `agente.turnos`. Si
 *    una aserción es tan frágil que necesita un segundo intento, la aserción
 *    está mal escrita; se arregla la aserción, no se tapa con un retry. Por eso
 *    las de conversación comprueban *hechos* (un precio, una hora, un código de
 *    reserva) y no frases literales.
 *
 *  - **Timeouts largos.** El agente encadena dos o tres herramientas contra
 *    Supabase antes de redactar: entre 4 y 12 segundos es lo normal, y el
 *    cliente HTTP de la app corta a los 30. Un timeout de prueba por debajo de
 *    eso convierte cada día lento en un falso rojo.
 *
 *  - **`reuseExistingServer`.** En esta máquina suele haber ya un `next dev`
 *    levantado. Arrancar otro encima da un puerto distinto al de `baseURL` y
 *    las pruebas se van contra un servidor que no es el que se cree.
 *
 * ⚠️ **Hace falta `N8N_AGENTE_URL` en `.env.local`.** Sin ella `agenteConfigurado()`
 * devuelve false, la landing no pinta el widget y las pruebas de chat fallan
 * con un «no encuentro el botón» que no dice nada. Es la *Production URL* del
 * Webhook, no la Test URL.
 */

const PUERTO = Number(process.env.E2E_PUERTO ?? 3002);
const BASE = process.env.E2E_BASE_URL ?? `http://localhost:${PUERTO}`;

export default defineConfig({
  testDir: "./tests/e2e",

  // Ver la cabecera: los contadores de cuota son globales y compartidos.
  workers: 1,
  fullyParallel: false,
  retries: 0,

  // Una conversación de varios turnos son varias llamadas de ~8 s seguidas.
  timeout: 180_000,
  expect: { timeout: 30_000 },

  forbidOnly: !!process.env.CI,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],

  // Borra las reservas y los turnos que haya creado la corrida. Ver el fichero.
  globalTeardown: "./tests/e2e/limpieza.ts",

  use: {
    baseURL: BASE,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 20_000,
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: {
    command: "npm run dev",
    url: BASE,
    reuseExistingServer: true,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
    env: { PORT: String(PUERTO) },
  },
});
