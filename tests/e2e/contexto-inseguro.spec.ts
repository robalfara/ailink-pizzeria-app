import { networkInterfaces } from "node:os";

import { expect, test } from "@playwright/test";

import { apuntarSesion, burbujas } from "./ayudas";

/**
 * El chat servido por `http://` a una IP de red, que NO es un contexto seguro.
 *
 * Esta prueba existe por un fallo real que el resto de la suite no podía ver.
 * Todo lo demás navega a `http://localhost:3002`, y `localhost` **sí** cuenta
 * como contexto seguro, igual que HTTPS. Por eso `crypto.randomUUID()` funciona
 * ahí y estaba verde todo, mientras que abriendo la misma página desde el móvil
 * de al lado —por la IP de red de la máquina, sin TLS— el chat se quedaba mudo
 * al pulsar enviar: ni burbuja, ni error a la vista, solo un
 * `crypto.randomUUID is not a function` en la consola del navegador.
 *
 * O sea: **la elección del host en la configuración de la suite era, sin
 * saberlo, parte de las condiciones del experimento.** Esta prueba cambia esa
 * condición a propósito.
 *
 * Si mañana se añade cualquier otra API restringida a contextos seguros
 * (`crypto.subtle`, portapapeles, notificaciones, geolocalización), esto la
 * caza el mismo día.
 */

/** La primera IPv4 de la máquina que no sea de loopback. */
function ipDeRed(): string | null {
  const interfaces = networkInterfaces();

  for (const nombre of Object.keys(interfaces)) {
    for (const dir of interfaces[nombre] ?? []) {
      if (dir.family === "IPv4" && !dir.internal) return dir.address;
    }
  }

  return null;
}

const IP = ipDeRed();
const PUERTO = Number(process.env.E2E_PUERTO ?? 3002);

test.describe("servido por http:// a una IP de red", () => {
  test.use({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.31" } });

  test.skip(
    IP === null,
    "Esta máquina no tiene ninguna IPv4 que no sea de loopback, así que no hay " +
      "forma de pedir la página desde un contexto no seguro.",
  );

  test.afterEach(async ({ page }) => {
    await apuntarSesion(page);
  });

  test("se puede mandar un mensaje y Nina contesta", async ({ page }) => {
    const base = `http://${IP}:${PUERTO}`;

    await page.goto(base);

    // Sin esto la prueba podría pasar sin haber probado nada: si el navegador
    // decidiera que esto SÍ es un contexto seguro, `randomUUID` existiría y
    // estaríamos repitiendo lo que ya cubre landing.spec.ts. La aserción fija la
    // condición del experimento.
    const inseguro = await page.evaluate(() => ({
      esSeguro: window.isSecureContext,
      tieneRandomUUID: typeof crypto?.randomUUID === "function",
    }));

    expect(
      inseguro.esSeguro,
      `${base} ha salido como contexto seguro, así que esta prueba no está ` +
        `probando lo que cree. Revisa si el navegador trata esa IP como de confianza.`,
    ).toBe(false);
    expect(inseguro.tieneRandomUUID).toBe(false);

    // Y ahora lo que importa: que el chat funcione igual.
    await page.getByRole("button", { name: "Abrir el chat con Nina" }).click();
    await expect(page.locator("#panel-chat")).toBeVisible();

    await page.locator("#mensaje-chat").fill("¿Cuánto cuesta la Marinara?");
    await page.getByRole("button", { name: "Enviar" }).click();

    // Dos burbujas nuevas: la del cliente y la de Nina. Antes del arreglo no
    // aparecía ni la del cliente, porque `enviarBorrador` reventaba en la línea
    // que generaba el identificador, antes de pintar nada.
    await expect(burbujas(page)).toHaveCount(3, { timeout: 40_000 });

    const respuesta = await burbujas(page).last().innerText();

    expect(respuesta, `respuesta: ${respuesta}`).toMatch(/8[,.]00/);
  });
});
