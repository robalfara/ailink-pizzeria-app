import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { expect, test } from "@playwright/test";

import {
  abrirChat,
  apuntarSesion,
  preguntar,
  sql,
  TESTIGO_PANICO,
  uuid,
} from "./ayudas";

/**
 * El aviso de que el chat se ha cortado solo.
 *
 * Esto existe porque **una alerta que deja de funcionar es el único tipo de
 * fallo que nadie nota**: no hay pantalla roja, no hay 500, no hay cliente
 * quejándose. Simplemente deja de llegar algo que ya casi nunca llegaba. Si
 * alguna vez se toca `Comprobar cuota`, `Redactar aviso` o
 * `agente.registrar_aviso()`, esta prueba es lo que avisa de que el aviso ya no
 * avisa.
 *
 * Hasta el 2026-09-17 esto iba a Telegram. El dueño lo retiró y el destino pasó
 * a ser `agente.avisos`, que es el único sitio al que n8n puede escribir sin una
 * credencial nueva.
 *
 * ⚠️ **Esta prueba corta el chat a todo el mundo durante unos segundos.** Usa el
 * interruptor de pánico (`agente.limites.activo = false`), que es global: no hay
 * forma de simular un corte para una sola sesión, porque el límite es del
 * negocio y no del cliente. Por eso:
 *
 *  - Se restaura en un `finally`, que corre aunque la aserción falle.
 *  - Antes de bajar el interruptor se deja un **testigo en disco**. Si el
 *    proceso muere entre medias, `limpieza.ts` lo encuentra y vuelve a subirlo.
 *  - El teardown **no** sube el interruptor si no hay testigo: si el dueño cortó
 *    el chat a propósito un sábado por la noche, una suite de pruebas no puede
 *    reabrirlo sola.
 */

test.afterEach(async ({ page }) => {
  // Igual que en chat.spec.ts: deja apuntada la sesión para que la limpieza
  // borre sus turnos.
  await apuntarSesion(page);
});

function bajarInterruptor() {
  mkdirSync(dirname(TESTIGO_PANICO), { recursive: true });
  // El testigo se escribe ANTES de tocar la base. Al revés, una muerte del
  // proceso entre las dos líneas dejaría el chat cortado y sin rastro de quién
  // lo hizo, que es exactamente el estado del que no se sale solo.
  writeFileSync(TESTIGO_PANICO, new Date().toISOString(), "utf8");
  sql("update agente.limites set activo = false;");
}

function subirInterruptor() {
  sql("update agente.limites set activo = true;");
  rmSync(TESTIGO_PANICO, { force: true });
}

test.describe("el aviso de corte", () => {
  test.use({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.21" } });

  test("un corte queda registrado en agente.avisos, y solo una vez", async ({
    page,
  }) => {
    // El pestillo de la 0005 da UN aviso por nivel y día, así que «ha aparecido
    // una fila nueva» no es una aserción estable: si la suite corre dos veces el
    // mismo día, la segunda no escribiría nada y esto daría rojo sin que nada
    // esté roto. Se guarda el id máximo para poder limpiar solo lo de esta
    // corrida, y se afirma sobre el estado, no sobre el incremento.
    const maximoPrevio = Number(
      sql("select coalesce(max(id), 0) from agente.avisos;") || "0",
    );

    await abrirChat(page);

    try {
      bajarInterruptor();

      // Con el interruptor bajado, `cuota()` corta antes del nodo Agent: no se
      // gasta un token. La respuesta es la de cortesía que redacta la propia
      // función, así que `preguntar` no sirve —comprueba que NO sea cortesía—.
      const respuesta = await page.request.post("/api/chat", {
        headers: { origin: page.url().replace(/\/$/, "") },
        data: { texto: "¿Cuánto cuesta la Marinara?", mensajeId: uuid() },
      });

      expect(respuesta.status()).toBe(200);
      expect(
        ((await respuesta.json()) as { respuesta: string }).respuesta,
      ).toContain("no está disponible");

      // El aviso lo escribe `Registrar aviso`, que cuelga de los «Responder…»:
      // corre DESPUÉS de contestar al cliente, así que puede llegar un instante
      // tarde. `expect.poll` espera a que aparezca en vez de dormir un número
      // inventado de segundos.
      await expect
        .poll(
          () =>
            Number(
              sql(
                "select count(*) from agente.avisos where nivel = 'corte' " +
                  "and (created_at at time zone 'Europe/Madrid')::date " +
                  "  = (now() at time zone 'Europe/Madrid')::date;",
              ) || "0",
            ),
          {
            message:
              "No se ha registrado el aviso de corte. Mira el nodo «Registrar aviso» " +
              "en n8n y que agente.registrar_aviso() siga concedida a agente_n8n.",
            timeout: 30_000,
            intervals: [1000, 1000, 2000, 2000, 5000],
          },
        )
        .toBeGreaterThan(0);

      // Y el antispam: un segundo corte el mismo día no puede escribir otra
      // fila. Esto sí es determinista dentro de la corrida, pase lo que pase con
      // lo que hubiera antes.
      const antes = Number(
        sql("select count(*) from agente.avisos where nivel = 'corte';") || "0",
      );

      await page.request.post("/api/chat", {
        headers: { origin: page.url().replace(/\/$/, "") },
        data: { texto: "¿y el horario?", mensajeId: uuid() },
      });

      await page.waitForTimeout(4000);

      const despues = Number(
        sql("select count(*) from agente.avisos where nivel = 'corte';") || "0",
      );

      expect(
        despues,
        "El pestillo de agente.avisos no está funcionando: un segundo corte el " +
          "mismo día ha escrito otra fila. Con un bucle de fallos, eso llena la " +
          "tabla y el registro deja de servir justo cuando hace falta.",
      ).toBe(antes);
    } finally {
      subirInterruptor();
      sql(`delete from agente.avisos where id > ${maximoPrevio};`);
    }
  });

  test("el chat vuelve a atender al subir el interruptor", async ({ page }) => {
    // La otra mitad de la prueba de arriba, y la que de verdad da tranquilidad:
    // que el corte se deshace. Un interruptor de pánico del que no se vuelve no
    // es un interruptor, es un fusible.
    expect(
      existsSync(TESTIGO_PANICO),
      "Ha quedado el testigo del interruptor de pánico: el chat podría seguir cortado.",
    ).toBe(false);

    await abrirChat(page);

    const respuesta = await preguntar(page, "¿Cuánto cuesta la Marinara?");

    expect(respuesta, `respuesta: ${respuesta}`).toMatch(/8[,.]00/);
  });
});
