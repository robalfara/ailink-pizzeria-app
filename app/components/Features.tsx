import { features } from "@/lib/data";

export default function Features() {
  return (
    <section id="caracteristicas" className="bg-paper py-20 md:py-28">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-sm font-semibold uppercase tracking-widest text-tomato">
            Por qué elegirnos
          </span>
          <h2 className="mt-3 font-display text-4xl font-extrabold tracking-tight text-charcoal md:text-5xl">
            Artesanía en cada porción
          </h2>
          <p className="mt-4 text-lg text-charcoal/65">
            No hacemos pizza rápido, la hacemos bien. Estos son los pilares que
            nos diferencian.
          </p>
        </div>

        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((feature) => (
            <article
              key={feature.title}
              className="group rounded-2xl border border-charcoal/10 bg-cream p-7 shadow-sm transition-all hover:-translate-y-1 hover:border-tomato/30 hover:shadow-lg"
            >
              <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-cream-deep text-3xl transition-transform group-hover:scale-110">
                <span aria-hidden>{feature.emoji}</span>
              </div>
              <h3 className="mt-5 font-display text-xl font-bold text-charcoal">
                {feature.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-charcoal/65">
                {feature.description}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
