export default function Hero() {
  return (
    <section className="relative overflow-hidden bg-charcoal text-cream">
      {/* Fondos decorativos */}
      <div
        className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-tomato/30 blur-3xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -bottom-32 -left-20 h-96 w-96 rounded-full bg-crust/20 blur-3xl"
        aria-hidden
      />

      <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-6 py-20 md:grid-cols-2 md:py-28">
        <div className="text-center md:text-left">
          <span className="inline-flex items-center gap-2 rounded-full border border-cream/20 bg-cream/5 px-4 py-1.5 text-xs font-medium uppercase tracking-widest text-crust">
            Auténtica pizza napolitana
          </span>

          <h1 className="mt-6 font-display text-5xl font-extrabold leading-[1.05] tracking-tight md:text-6xl">
            El sabor de Nápoles,
            <span className="block text-crust">recién salido del horno</span>
          </h1>

          <p className="mx-auto mt-6 max-w-md text-lg leading-relaxed text-cream/70 md:mx-0">
            Masa de fermentación lenta de 48 horas, horno de leña a 450 °C e
            ingredientes DOP importados de Italia. Cada pizza, una obra de arte.
          </p>

          <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row md:items-start md:justify-start">
            <a
              href="#carta"
              className="w-full rounded-full bg-tomato px-8 py-3.5 text-center text-base font-semibold text-cream shadow-lg shadow-tomato/20 transition-transform hover:scale-105 sm:w-auto"
            >
              Ver la carta
            </a>
            <a
              href="#caracteristicas"
              className="w-full rounded-full border border-cream/25 px-8 py-3.5 text-center text-base font-semibold text-cream transition-colors hover:bg-cream/10 sm:w-auto"
            >
              Nuestra historia
            </a>
          </div>

          <dl className="mt-12 flex justify-center gap-10 md:justify-start">
            <div>
              <dt className="font-display text-3xl font-bold text-crust">15+</dt>
              <dd className="text-sm text-cream/60">Años de tradición</dd>
            </div>
            <div>
              <dt className="font-display text-3xl font-bold text-crust">48h</dt>
              <dd className="text-sm text-cream/60">De fermentación</dd>
            </div>
            <div>
              <dt className="font-display text-3xl font-bold text-crust">4.9★</dt>
              <dd className="text-sm text-cream/60">+2.000 reseñas</dd>
            </div>
          </dl>
        </div>

        {/* Pizza ilustrada con CSS puro (sin imágenes externas) */}
        <div className="relative mx-auto hidden aspect-square w-full max-w-md md:block">
          <div className="absolute inset-0 animate-[spin_60s_linear_infinite] rounded-full bg-gradient-to-br from-crust via-crust-dark to-tomato-dark shadow-2xl">
            <div className="absolute inset-[6%] rounded-full bg-gradient-to-br from-[#e8524a] to-tomato-dark">
              <div className="absolute inset-[10%] rounded-full bg-gradient-to-br from-[#d9483f] to-[#a52a1e]">
                {/* toppings */}
                {[
                  "top-[18%] left-[30%]",
                  "top-[26%] right-[22%]",
                  "top-[52%] left-[20%]",
                  "bottom-[20%] right-[30%]",
                  "bottom-[26%] left-[40%]",
                  "top-[40%] right-[36%]",
                ].map((pos, i) => (
                  <span
                    key={i}
                    className={`absolute ${pos} h-8 w-8 rounded-full bg-[#8c1c13] shadow-inner ring-2 ring-[#701009]`}
                    aria-hidden
                  />
                ))}
                {["top-[38%] left-[28%]", "bottom-[34%] right-[24%]", "top-[58%] right-[42%]"].map(
                  (pos, i) => (
                    <span
                      key={`b-${i}`}
                      className={`absolute ${pos} h-4 w-4 rounded-full bg-basil`}
                      aria-hidden
                    />
                  )
                )}
              </div>
            </div>
          </div>
          <span
            className="absolute -bottom-4 left-1/2 -translate-x-1/2 text-6xl drop-shadow-lg"
            aria-hidden
          >
            🍕
          </span>
        </div>
      </div>
    </section>
  );
}
