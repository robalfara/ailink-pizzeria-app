import { expect, test } from "@playwright/test";

import { abrirChat, burbujas, plano } from "./ayudas";

/**
 * La landing y el widget: todo lo que se puede comprobar sin gastar un token.
 *
 * Estas pruebas no hablan con n8n. Son las que tienen que estar verdes antes de
 * mirar nada de la conversación: si la carta no se pinta o el widget no se
 * despliega, un fallo en el chat no dice nada porque el problema está antes.
 */

test.describe("la landing", () => {
  test("responde y pinta la carta que viene de la base de datos", async ({
    page,
  }) => {
    const respuesta = await page.goto("/");

    expect(respuesta?.status()).toBe(200);

    // Precios concretos, no un «hay algo con un €». La carta vive SOLO en la
    // base (`0002_carta.sql`), así que estos dos números son la prueba de que
    // el camino app → Supabase funciona de verdad.
    //
    // Y es la prueba de regresión de un fallo real: `anon` y `authenticated`
    // se quedaron sin ningún grant sobre las tablas de `public`, y la landing
    // siguió devolviendo 200 con la carta vacía mientras el servidor escupía
    // `42501 permission denied for table categorias` en su log. Verde por
    // fuera, rota por dentro. Está reparado en
    // `supabase/reparacion-grants-public.sql`.
    const cuerpo = plano(await page.locator("body").innerText());

    expect(cuerpo, "no aparece la Marinara con su precio").toContain("marinara");
    expect(cuerpo).toMatch(/8[,.]00\s*€/);
    expect(cuerpo, "no aparece el Tartufo Nero con su precio").toContain(
      "tartufo nero",
    );
    expect(cuerpo).toMatch(/15[,.]50\s*€/);
  });

  test("manda las cabeceras de seguridad", async ({ request }) => {
    const respuesta = await request.get("/");
    const cabeceras = respuesta.headers();

    expect(cabeceras["x-content-type-options"]).toBe("nosniff");
    expect(cabeceras["x-frame-options"]).toBe("DENY");
    expect(cabeceras["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(cabeceras["strict-transport-security"]).toContain("max-age=");
    expect(cabeceras["permissions-policy"]).toContain("microphone=()");

    // De la CSP solo se fijan las partes que no cambian entre dev y producción.
    // En desarrollo Next necesita `unsafe-eval` y `ws:` para el refresco en
    // caliente, así que comprobar la cadena entera daría rojo en local y verde
    // en producción, que es la peor combinación posible.
    const csp = cabeceras["content-security-policy"] ?? "";

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");

    // `poweredByHeader: false` en next.config.ts.
    expect(cabeceras["x-powered-by"]).toBeUndefined();
  });
});

test.describe("el widget del chat", () => {
  test("se despliega, saluda y deja escribir", async ({ page }) => {
    await abrirChat(page);

    const panel = page.locator("#panel-chat");

    await expect(panel).toBeVisible();
    await expect(panel.getByText("Nina", { exact: true })).toBeVisible();

    // El saludo lo pinta el cliente, no el agente: tiene que estar ahí sin
    // haber hablado con n8n.
    await expect(burbujas(page).first()).toContainText("Soy Nina");

    const campo = page.locator("#mensaje-chat");

    await expect(campo).toBeEnabled();
    await expect(campo).toBeFocused();

    // El botón de enviar nace apagado: sin texto no se manda nada.
    await expect(page.getByRole("button", { name: "Enviar" })).toBeDisabled();
    await campo.fill("hola");
    await expect(page.getByRole("button", { name: "Enviar" })).toBeEnabled();
  });

  test("avisa de que es un asistente automático", async ({ page }) => {
    // Bloque 10.2 del checklist: tiene que estar a la vista, no enterrado.
    await abrirChat(page);

    await expect(page.locator("#panel-chat")).toContainText(
      "asistente automático",
    );
    await expect(page.locator("#panel-chat")).toContainText("90 días");
  });

  test("se puede cerrar y se vuelve a abrir con la conversación intacta", async ({
    page,
  }) => {
    await abrirChat(page);

    await page.getByRole("button", { name: "Cerrar el chat" }).click();
    await expect(page.locator("#panel-chat")).toBeHidden();

    await page.getByRole("button", { name: "Abrir el chat con Nina" }).click();
    await expect(page.locator("#panel-chat")).toBeVisible();
    await expect(burbujas(page)).toHaveCount(1);
  });
});
