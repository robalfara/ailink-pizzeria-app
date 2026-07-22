import { menu } from "@/lib/data";

const tagStyles: Record<string, string> = {
  Veggie: "bg-basil/15 text-basil",
  Vegana: "bg-basil/15 text-basil",
  Picante: "bg-tomato/15 text-tomato",
};

export default function Menu() {
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
          {menu.map((category) => (
            <div key={category.id}>
              <div className="mb-8 flex items-center gap-3">
                <span className="text-2xl" aria-hidden>
                  {category.emoji}
                </span>
                <h3 className="font-display text-2xl font-bold text-crust">
                  {category.title}
                </h3>
                <span className="h-px flex-1 bg-cream/15" aria-hidden />
              </div>

              <div className="grid gap-x-12 gap-y-7 md:grid-cols-2">
                {category.items.map((item) => (
                  <article key={item.name} className="group">
                    <div className="flex items-baseline gap-3">
                      <h4 className="font-display text-lg font-semibold text-cream">
                        {item.name}
                      </h4>
                      <span
                        className="h-px flex-1 translate-y-[-2px] border-b border-dashed border-cream/20"
                        aria-hidden
                      />
                      <span className="font-display text-lg font-bold text-crust">
                        {item.price}
                      </span>
                    </div>
                    <p className="mt-1.5 text-sm leading-relaxed text-cream/55">
                      {item.description}
                    </p>
                    {item.tags && item.tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {item.tags.map((tag) => (
                          <span
                            key={tag}
                            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                              tagStyles[tag] ?? "bg-cream/10 text-cream/70"
                            }`}
                          >
                            {tag}
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
