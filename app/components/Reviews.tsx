import { reviews } from "@/lib/data";

function Stars({ rating }: { rating: number }) {
  return (
    <div
      className="flex gap-0.5 text-crust"
      aria-label={`${rating} de 5 estrellas`}
    >
      {Array.from({ length: 5 }).map((_, i) => (
        <span key={i} aria-hidden>
          {i < rating ? "★" : "☆"}
        </span>
      ))}
    </div>
  );
}

export default function Reviews() {
  return (
    <section id="reseñas" className="bg-cream-deep py-20 md:py-28">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-sm font-semibold uppercase tracking-widest text-tomato">
            Lo que dicen de nosotros
          </span>
          <h2 className="mt-3 font-display text-4xl font-extrabold tracking-tight text-charcoal md:text-5xl">
            Amado por el barrio
          </h2>
          <p className="mt-4 text-lg text-charcoal/65">
            Más de 2.000 clientes nos avalan con una media de 4,9 sobre 5.
          </p>
        </div>

        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {reviews.map((review) => (
            <figure
              key={review.name}
              className="flex flex-col rounded-2xl border border-charcoal/10 bg-cream p-7 shadow-sm"
            >
              <Stars rating={review.rating} />
              <blockquote className="mt-4 flex-1 text-charcoal/80">
                <p className="leading-relaxed">“{review.quote}”</p>
              </blockquote>
              <figcaption className="mt-6 flex items-center gap-3 border-t border-charcoal/10 pt-5">
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-tomato font-display text-sm font-bold text-cream">
                  {review.initials}
                </span>
                <div>
                  <div className="font-semibold text-charcoal">
                    {review.name}
                  </div>
                  <div className="text-sm text-charcoal/55">{review.role}</div>
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
