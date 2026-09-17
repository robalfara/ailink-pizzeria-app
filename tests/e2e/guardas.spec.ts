import { expect, test } from "@playwright/test";

import { uuid } from "./ayudas";

/**
 * Los rechazos de `/api/chat`, o sea todo lo que la puerta corta ANTES de
 * hablar con n8n.
 *
 * Es la parte barata de la suite y por eso está completa: nada de lo que hay
 * aquí gasta un token ni despierta al workflow. Se comprueba contra el
 * endpoint, no contra el módulo, porque lo que importa no es que
 * `validarMensajeChat` sepa decir que no: es que el handler lo llame antes de
 * gastar.
 *
 * ⚠️ **Lo que NO se prueba aquí, y es una decisión, no un olvido:** el cubo de
 * 20 mensajes por cliente cada 5 minutos. Para llenarlo hacen falta 20
 * peticiones ACEPTADAS —un rechazo no consume cuota, por diseño—, o sea 20
 * llamadas reales al agente: dos minutos largos, tokens de verdad, 20 filas en
 * `agente.turnos` y, de propina, el techo global de 30/min disparado, que
 * dejaría en rojo todo lo que corriera detrás durante un minuto. El arnés
 * rompería más de lo que mide. Los cubos y los techos están medidos en
 * `lib/limites.ts` con 360.000 peticiones; el sitio de esa prueba es un test
 * unitario del módulo, no la suite de punta a punta.
 */

test.describe("la puerta del chat", () => {
  test("rechaza un POST de otro origen con 403", async ({ request }) => {
    // Cross-site: las cookies son SameSite=Lax, así que esto llegaría sin
    // sesión, pero gastaría tokens ajenos igualmente.
    const respuesta = await request.post("/api/chat", {
      headers: { origin: "https://pizzeria-que-no-es.example" },
      data: { texto: "hola", mensajeId: uuid() },
    });

    expect(respuesta.status()).toBe(403);
    expect(await respuesta.json()).toEqual({ error: "origen_no_permitido" });
  });

  test("rechaza un Origin que ni siquiera es una URL", async ({ request }) => {
    const respuesta = await request.post("/api/chat", {
      headers: { origin: "no-soy-una-url" },
      data: { texto: "hola", mensajeId: uuid() },
    });

    expect(respuesta.status()).toBe(403);
  });

  test("corta un cuerpo de más de 4 KB con 413, sin parsearlo", async ({
    request,
  }) => {
    // 9 KB. El tope de 1000 caracteres de `validarMensajeChat` también lo
    // rechazaría, pero solo DESPUÉS de bufferear y parsear el JSON entero: el
    // guard de `content-length` existe justo para no pagar eso.
    const respuesta = await request.post("/api/chat", {
      data: { texto: "a".repeat(9000), mensajeId: uuid() },
    });

    expect(respuesta.status()).toBe(413);
    expect(await respuesta.json()).toEqual({ error: "cuerpo_demasiado_grande" });
  });

  test("rechaza un mensajeId que no es un UUID", async ({ request }) => {
    // El `mensajeId` es la clave de idempotencia y se prefija con el sessionId
    // antes de salir hacia n8n. Si aquí entrara cualquier cadena, el namespace
    // dejaría de ser un namespace.
    const respuesta = await request.post("/api/chat", {
      data: { texto: "hola", mensajeId: "123" },
    });

    expect(respuesta.status()).toBe(400);

    const cuerpo = await respuesta.json();

    expect(cuerpo.error).toBe("mensaje_invalido");
    expect(cuerpo.motivo).toContain("UUID");
  });

  test("rechaza un cuerpo que no es JSON", async ({ request }) => {
    // Bytes crudos, a propósito: si se le pasa una cadena con
    // `content-type: application/json`, Playwright la serializa a JSON y lo
    // que llega al servidor es un JSON válido (una cadena), que el handler
    // rechaza más adelante por no ser un objeto. Con un Buffer se manda tal
    // cual y se ejerce el camino que se quiere probar: el `catch` del
    // `request.json()`.
    const respuesta = await request.post("/api/chat", {
      headers: { "content-type": "application/json" },
      data: Buffer.from("{esto no es json", "utf8"),
    });

    expect(respuesta.status()).toBe(400);
    expect(await respuesta.json()).toEqual({ error: "cuerpo_invalido" });
  });

  test("rechaza un mensaje vacío o en blanco", async ({ request }) => {
    for (const texto of ["", "   ", "\n\t "]) {
      const respuesta = await request.post("/api/chat", {
        data: { texto, mensajeId: uuid() },
      });

      expect(respuesta.status(), `texto=${JSON.stringify(texto)}`).toBe(400);
      expect((await respuesta.json()).motivo).toContain("Falta el texto");
    }
  });

  test("rechaza un mensaje de más de 1000 caracteres", async ({ request }) => {
    // 1001 caracteres son ~1 KB: pasan el guard de tamaño y los para el
    // validador, que es exactamente el reparto que se quería.
    const respuesta = await request.post("/api/chat", {
      data: { texto: "á".repeat(1001), mensajeId: uuid() },
    });

    expect(respuesta.status()).toBe(400);
    expect((await respuesta.json()).motivo).toContain("1000 caracteres");
  });

  test("no contesta a un GET", async ({ request }) => {
    const respuesta = await request.get("/api/chat");

    expect(respuesta.status()).toBe(405);
  });
});
