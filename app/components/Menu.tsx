import { obtenerCarta } from "@/lib/dal";

/**
 * La carta se lee de la base de datos, no de `lib/data.ts`.
 *
 * Había dos cartas: la hardcodeada que pintaba esto y la tabla `platos` que lee
 * el agente. Plato a plato coincidían, pero ya divergían en lo estructural: la
 * columna `disponible` no llegaba hasta aquí, así que un plato agotado
 * desaparecía de lo que cuenta el agente y la landing lo seguía anunciando.
 * Ahora hay una sola fuente y el filtro lo hace la policy RLS
 * (`using (disponible)`), no un WHERE que haya que recordar.
 */

const tagStyles: Record<string, string> = {
  Veggie: "bg-basil/15 text-basil",
  Vegana: "bg-basil/15 text-basil",
  Picante: "bg-tomato/15 text-tomato",
};

/**
 * Los precios viajan como enteros de céntimos —en la base de datos el dinero
 * nunca es texto ni float— y se formatean aquí, que es donde se ven. El
 * formateador se construye una vez: `Intl.NumberFormat` es caro de crear y
 * barato de reusar.
 */
const euros = new Intl.NumberFormat("es-ES", {
  style: "currency",
  currency: "EUR",
});

export default async function Menu() {
  const carta = await obtenerCarta();

  return (
    <section id="carta" className="bg-charcoal py-20 text-cream md:py-28">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-sm font-semibold uppercase tracking-widest text-crust">
            Nuestra carta
          </span>
          <h2 className="mt-3 font-display text-4xl font-extrabold tracking-tight md:text-5xl">
            Del horno a tu mesa
          </h2>
          <p className="mt-4 text-lg text-cream/60">
            Elaboradas al momento con productos de temporada. Precios con IVA
            incluido.
          </p>
        </div>

        <div className="mt-16 space-y-16">
          {carta.map((categoria) => (
            <div key={categoria.id}>
              <div className="mb-8 flex items-center gap-3">
                <span className="text-2xl" aria-hidden>
                  {categoria.emoji}
                </span>
                <h3 className="font-display text-2xl font-bold text-crust">
                  {categoria.titulo}
                </h3>
                <span className="h-px flex-1 bg-cream/15" aria-hidden />
              </div>

              <div className="grid gap-x-12 gap-y-7 md:grid-cols-2">
                {categoria.platos.map((plato) => (
                  <article key={plato.id} className="group">
                    <div className="flex items-baseline gap-3">
                      <h4 className="font-display text-lg font-semibold text-cream">
                        {plato.nombre}
                      </h4>
                      <span
                        className="h-px flex-1 translate-y-[-2px] border-b border-dashed border-cream/20"
                        aria-hidden
                      />
                      <span className="font-display text-lg font-bold text-crust">
                        {euros.format(plato.precioCents / 100)}
                      </span>
                    </div>
                    <p className="mt-1.5 text-sm leading-relaxed text-cream/55">
                      {plato.descripcion}
                    </p>
                    {plato.etiquetas.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {plato.etiquetas.map((etiqueta) => (
                          <span
                            key={etiqueta}
                            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                              tagStyles[etiqueta] ?? "bg-cream/10 text-cream/70"
                            }`}
                          >
                            {etiqueta}
                          </span>
                        ))}
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </div>
          ))}
        </div>

        <p className="mt-16 text-center text-sm text-cream/45">
          ¿Alergias o intolerancias? Consúltanos, adaptamos cualquier pizza. 🌾
        </p>
      </div>
    </section>
  );
}
