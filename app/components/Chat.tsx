"use client";

import { useEffect, useRef, useState } from "react";

/**
 * El widget del chat: la parte visible del agente de sala.
 *
 * Decisiones que no son de estilo y conviene no deshacer sin pensarlas:
 *
 *  - **Mientras hay una respuesta en vuelo, el campo se bloquea.** Es la
 *    respuesta al bloque 2.4 del checklist (mensajes seguidos): en lugar de
 *    montar una espera y una agrupación por sesión en n8n, aquí simplemente no
 *    se puede mandar el segundo mensaje hasta que llegue el primero. Un chat de
 *    web lo permite; WhatsApp no, y por eso allí sí haría falta el buffer.
 *
 *  - **El `mensajeId` se genera una vez por mensaje y se conserva al
 *    reintentar.** Es la clave de idempotencia (bloque 2.5): si la red se cae
 *    después de que n8n haya contestado, reintentar con el mismo id devuelve la
 *    respuesta que ya se generó en vez de gastar otra ronda de tokens.
 *
 *  - **La sesión no se toca desde aquí.** No hay `sessionId` en este fichero, y
 *    es a propósito: lo decide el servidor a partir de la cookie o de la
 *    sesión de Supabase.
 */

type Mensaje = {
  id: string;
  de: "cliente" | "nina";
  texto: string;
  /** Solo en los del cliente: para poder reintentar con el mismo id. */
  fallido?: boolean;
};

const SALUDO =
  "¡Hola! Soy Nina, del Forno Nostro. Te cuento la carta, los horarios o te " +
  "guardo mesa. ¿Qué necesitas?";

/**
 * El identificador de idempotencia de un mensaje.
 *
 * ⚠️ **`crypto.randomUUID()` no existe fuera de un contexto seguro.** Está
 * restringido a HTTPS y a `localhost`; por `http://` a una IP de red —que es
 * exactamente como se prueba esto desde el móvil o desde otro portátil de la
 * casa— la propiedad es `undefined` y la llamada revienta con
 * *crypto.randomUUID is not a function*. El chat se quedaba mudo al pulsar
 * enviar, sin burbuja y sin error visible: el fallo se veía solo en la consola
 * del navegador.
 *
 * `crypto.getRandomValues()`, en cambio, SÍ está disponible en contextos no
 * seguros, así que el UUID v4 se arma a mano con él. Misma calidad de aleatorio,
 * misma forma: `lib/validacion.ts` comprueba la forma, no la versión.
 *
 * El último recurso con `Math.random()` es para un navegador sin `crypto`
 * ninguno. Merece decirse que ahí no se pierde seguridad: el servidor prefija
 * este id con el `sessionId` antes de usarlo (`${sessionId}#${mensajeId}` en
 * `app/api/chat/route.ts`), así que adivinar el de otro no sirve de nada. Lo
 * único que una colisión puede provocar es que te devuelvan tu propia respuesta
 * anterior.
 */
function nuevoMensajeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = crypto.getRandomValues(new Uint8Array(16));

    bytes[6] = (bytes[6] & 0x0f) | 0x40; // versión 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variante RFC 4122

    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

    return (
      `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-` +
      `${hex.slice(16, 20)}-${hex.slice(20)}`
    );
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;

    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export default function Chat() {
  const [abierto, setAbierto] = useState(false);
  const [mensajes, setMensajes] = useState<Mensaje[]>([
    { id: "saludo", de: "nina", texto: SALUDO },
  ]);
  const [borrador, setBorrador] = useState("");
  const [esperando, setEsperando] = useState(false);

  const finRef = useRef<HTMLDivElement>(null);
  const campoRef = useRef<HTMLInputElement>(null);

  // El scroll sigue a la conversación. `mensajes.length` y no `mensajes`: solo
  // interesa cuando aparece uno nuevo.
  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensajes.length, esperando]);

  useEffect(() => {
    if (abierto) campoRef.current?.focus();
  }, [abierto]);

  async function enviar(texto: string, mensajeId: string) {
    setEsperando(true);

    try {
      const respuesta = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ texto, mensajeId }),
      });

      const cuerpo = (await respuesta.json().catch(() => null)) as {
        respuesta?: string;
      } | null;

      // El handler contesta 200 con texto incluso cuando el agente ha fallado,
      // así que aquí solo queda el caso de que ni siquiera se pueda leer el
      // cuerpo: red caída, servidor tumbado o un 400 por validación.
      const textoRespuesta = cuerpo?.respuesta;

      if (!textoRespuesta) throw new Error("respuesta ilegible");

      // El valor se saca a una const antes del `setMensajes`: dentro del
      // closure TypeScript pierde el estrechamiento del `if` de arriba (nada
      // le garantiza que el objeto no haya cambiado para cuando se ejecute) y
      // había que taparlo con un `!`. Sacándolo, el `!` sobra de verdad.
      setMensajes((previos) => [
        ...previos,
        { id: `${mensajeId}-r`, de: "nina", texto: textoRespuesta },
      ]);
    } catch {
      // No se pinta un mensaje de Nina: se marca el del cliente como fallido y
      // se le ofrece reintentarlo. Así queda claro que no llegó a salir, en vez
      // de dejar una disculpa suelta que parece una respuesta.
      setMensajes((previos) =>
        previos.map((m) => (m.id === mensajeId ? { ...m, fallido: true } : m)),
      );
    } finally {
      setEsperando(false);
      campoRef.current?.focus();
    }
  }

  function enviarBorrador(evento: React.FormEvent) {
    evento.preventDefault();

    const texto = borrador.trim();

    if (!texto || esperando) return;

    const mensajeId = nuevoMensajeId();

    setMensajes((previos) => [
      ...previos,
      { id: mensajeId, de: "cliente", texto },
    ]);
    setBorrador("");

    void enviar(texto, mensajeId);
  }

  function reintentar(mensaje: Mensaje) {
    // La invariante de la cabecera —una sola respuesta en vuelo— la respetaba
    // `enviarBorrador` y se la saltaba esta función. Con dos mensajes fallidos
    // en pantalla se podían lanzar dos peticiones a la vez: el primer `finally`
    // en llegar desbloqueaba el campo con la otra todavía en vuelo, y las
    // respuestas se pintaban por orden de llegada, no por orden de envío.
    if (esperando) return;

    setMensajes((previos) =>
      previos.map((m) => (m.id === mensaje.id ? { ...m, fallido: false } : m)),
    );
    void enviar(mensaje.texto, mensaje.id);
  }

  return (
    <>
      {/* Botón flotante. z-40 para quedar por debajo de la Navbar sticky. */}
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        aria-controls="panel-chat"
        className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-tomato text-2xl text-cream shadow-lg transition-transform hover:scale-105 hover:bg-tomato-dark focus:outline-none focus-visible:ring-4 focus-visible:ring-crust/60"
      >
        <span aria-hidden>{abierto ? "✕" : "💬"}</span>
        <span className="sr-only">
          {abierto ? "Cerrar el chat" : "Abrir el chat con Nina"}
        </span>
      </button>

      {abierto && (
        <section
          id="panel-chat"
          aria-label="Chat con Nina, la anfitriona"
          className="fixed bottom-24 right-5 z-40 flex h-[min(32rem,calc(100vh-8rem))] w-[min(23rem,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-3xl border border-charcoal/10 bg-cream shadow-2xl"
        >
          <header className="flex items-center gap-3 border-b border-charcoal/10 bg-cream-deep px-5 py-4">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-tomato text-lg" aria-hidden>
              🍕
            </span>
            <div>
              <p className="font-display text-base font-bold leading-tight text-charcoal">
                Nina
              </p>
              <p className="text-xs text-charcoal/60">
                Carta, horarios y reservas
              </p>
            </div>
          </header>

          <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
            {mensajes.map((mensaje) => (
              <div key={mensaje.id}>
                {/* `data-*` para que las pruebas de punta a punta puedan leer
                    la conversación sin agarrarse a clases de Tailwind, que
                    cambian con el diseño y dejarían la suite roja por un
                    retoque de color. */}
                <p
                  data-testid="burbuja"
                  data-de={mensaje.de}
                  className={
                    mensaje.de === "cliente"
                      ? "ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-tomato px-4 py-2 text-sm text-cream"
                      : "w-fit max-w-[85%] rounded-2xl rounded-bl-sm bg-cream-deep px-4 py-2 text-sm text-charcoal"
                  }
                >
                  {mensaje.texto}
                </p>

                {mensaje.fallido && (
                  <p className="ml-auto mt-1 w-fit text-xs text-tomato">
                    No se pudo enviar.{" "}
                    {/* El guard de `reintentar` es la defensa real; el
                        `disabled` es para que además se vea, en vez de dejar
                        un botón que parece pulsable y no hace nada. */}
                    <button
                      type="button"
                      onClick={() => reintentar(mensaje)}
                      disabled={esperando}
                      className="font-semibold underline hover:no-underline disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline"
                    >
                      Reintentar
                    </button>
                  </p>
                )}
              </div>
            ))}

            {esperando && (
              <p
                className="w-fit rounded-2xl rounded-bl-sm bg-cream-deep px-4 py-2 text-sm text-charcoal/50"
                aria-live="polite"
              >
                Nina está escribiendo…
              </p>
            )}

            <div ref={finRef} />
          </div>

          <form
            onSubmit={enviarBorrador}
            className="flex items-center gap-2 border-t border-charcoal/10 px-4 py-3"
          >
            <label htmlFor="mensaje-chat" className="sr-only">
              Escribe tu mensaje
            </label>
            <input
              id="mensaje-chat"
              ref={campoRef}
              value={borrador}
              onChange={(e) => setBorrador(e.target.value)}
              disabled={esperando}
              maxLength={1000}
              autoComplete="off"
              placeholder={esperando ? "Un segundo…" : "Escribe aquí…"}
              className="min-w-0 flex-1 rounded-full border border-charcoal/15 bg-cream px-4 py-2 text-sm text-charcoal placeholder:text-charcoal/40 focus:border-tomato focus:outline-none disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={esperando || borrador.trim().length === 0}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-tomato text-cream transition-colors hover:bg-tomato-dark disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span aria-hidden>↑</span>
              <span className="sr-only">Enviar</span>
            </button>
          </form>

          {/* Bloque 10.2: el usuario tiene que saber que habla con una máquina
              y qué se hace con lo que escribe. Va a la vista, no enterrado. */}
          <p className="border-t border-charcoal/10 bg-cream-deep px-5 py-2 text-[11px] leading-snug text-charcoal/50">
            Nina es un asistente automático. Guardamos la conversación 90 días
            para poder revisarla si algo sale mal.
          </p>
        </section>
      )}
    </>
  );
}
