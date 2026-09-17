import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";

import { REGISTRO_SESIONES, TESTIGO_PANICO } from "./ayudas";

/**
 * Teardown global: borra lo que la corrida haya escrito en la base de datos.
 *
 * Las pruebas de conversación crean **reservas de verdad** en el mismo Supabase
 * que atiende a la pizzería —no hay proyecto de pruebas— y dejan una fila por
 * turno en `agente.turnos`. Sin esto, la agenda de un viernes se va llenando de
 * gente que no existe y alguien acaba guardando mesas para nadie.
 *
 * Borra **solo** los `sessionId` que las pruebas han apuntado en
 * `test-results/sesiones-e2e.txt` (ver `apuntarSesion`). Nada de `like 'prueba:%'`
 * ni de barridos por fecha: el `sessionId` lo decide el servidor y una prueba no
 * puede elegirse un prefijo, así que la única forma honesta de acotar el borrado
 * es la lista exacta de sesiones que se estrenaron.
 *
 * La contraseña no entra nunca en este proceso: el `grep` de una sola clave va
 * dentro del comando que ejecuta el contenedor, igual que en la receta del
 * handoff. Se usa `docker` porque esta máquina no tiene `psql` instalado.
 */

const HOST = "aws-1-eu-west-1.pooler.supabase.com";
const REF = "kjxxickmrmranqmvgdie";

/** `a:<uuid>` para los anónimos, `u:<uuid>` para quien tiene sesión. */
const FORMATO_SESION =
  /^[au]:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Lo primero de todo: dejar el chat abierto si una prueba lo cerró.
 *
 * `avisos.spec.ts` baja el interruptor de pánico para comprobar que el corte se
 * registra, y lo sube en un `finally`. Esto es la segunda red, para cuando ese
 * `finally` no llega a correr — una aserción que revienta el worker, un Ctrl+C a
 * destiempo—. Sin ella, el chat se queda cortado para todo el mundo hasta que
 * alguien se dé cuenta.
 *
 * **Solo actúa si existe el testigo.** Subir el interruptor incondicionalmente
 * sería peor que el problema: si el dueño cortó el chat a propósito un sábado
 * por la noche, pasar la suite se lo reabriría sin decir nada.
 */
function reabrirSiLoCerramosNosotros() {
  if (!existsSync(TESTIGO_PANICO)) return;

  const comando =
    `docker run --rm -i ` +
    `-e PGPASSWORD="$(grep '^SUPABASE_DB_PASSWORD=' .env.local | cut -d= -f2-)" ` +
    `postgres:16-alpine psql ` +
    `"host=${HOST} port=5432 dbname=postgres user=postgres.${REF} sslmode=require" ` +
    `-At -v ON_ERROR_STOP=1 -c "update agente.limites set activo = true;"`;

  try {
    execFileSync("bash", ["-c", comando], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
    });
    rmSync(TESTIGO_PANICO, { force: true });
    console.warn(
      "[limpieza] el interruptor de pánico se había quedado bajado; chat reabierto.",
    );
  } catch (error) {
    // Esto no se traga: el chat está caído para todo el mundo.
    throw new Error(
      "[limpieza] EL CHAT SIGUE CORTADO. Una prueba bajó el interruptor de pánico " +
        "y no se ha podido volver a subir. Ejecuta esto YA en el SQL Editor:\n\n" +
        "  update agente.limites set activo = true;\n\n" +
        `Motivo: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export default function limpieza() {
  reabrirSiLoCerramosNosotros();

  if (!existsSync(REGISTRO_SESIONES)) {
    console.log("[limpieza] no hay sesiones apuntadas: nada que borrar.");
    return;
  }

  const sesiones = [
    ...new Set(
      readFileSync(REGISTRO_SESIONES, "utf8")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean),
    ),
  ];

  // Un `sessionId` que no tenga la forma esperada no se borra y no se
  // interpola: se avisa. Estas cadenas acaban dentro de un literal SQL.
  const validas = sesiones.filter((s) => FORMATO_SESION.test(s));
  const raras = sesiones.filter((s) => !FORMATO_SESION.test(s));

  if (raras.length > 0) {
    console.warn(
      `[limpieza] ${raras.length} sesión(es) con formato inesperado, no se tocan.`,
    );
  }

  if (validas.length === 0) {
    rmSync(REGISTRO_SESIONES, { force: true });
    return;
  }

  const lista = validas.map((s) => `'${s}'`).join(",");
  const sql =
    `delete from public.reservas where session_id in (${lista});` +
    `delete from agente.turnos  where session_id in (${lista});`;

  const comando =
    `docker run --rm -i ` +
    `-e PGPASSWORD="$(grep '^SUPABASE_DB_PASSWORD=' .env.local | cut -d= -f2-)" ` +
    `postgres:16-alpine psql ` +
    `"host=${HOST} port=5432 dbname=postgres user=postgres.${REF} sslmode=require" ` +
    `-v ON_ERROR_STOP=1 --single-transaction -q -c ${JSON.stringify(sql)}`;

  try {
    const salida = execFileSync("bash", ["-c", comando], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120_000,
    });

    console.log(
      `[limpieza] ${validas.length} sesión(es) borradas de reservas y turnos.` +
        (salida.trim() ? `\n${salida.trim()}` : ""),
    );
    rmSync(REGISTRO_SESIONES, { force: true });
  } catch (error) {
    // No se borra el registro: así un segundo intento lo vuelve a coger.
    const motivo = error instanceof Error ? error.message : String(error);

    throw new Error(
      `[limpieza] NO se han podido borrar las reservas de prueba. Quedan ${validas.length} ` +
        `sesión(es) sucias en la base de producción y hay que borrarlas a mano.\n\n` +
        `Motivo: ${motivo}\n\n` +
        `SQL a pasar por el SQL Editor del dashboard:\n\n${sql.replace(/;/g, ";\n")}\n\n` +
        `La lista también sigue en ${REGISTRO_SESIONES}.`,
    );
  }
}
