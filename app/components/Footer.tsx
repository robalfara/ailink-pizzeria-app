export default function Footer() {
  return (
    <footer className="bg-charcoal text-cream/70">
      <div className="mx-auto grid max-w-6xl gap-10 px-6 py-16 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2 lg:col-span-1">
          <div className="flex items-center gap-2">
            <span className="text-2xl" aria-hidden>
              🍕
            </span>
            <span className="font-display text-xl font-extrabold text-cream">
              Forno Nostro
            </span>
          </div>
          <p className="mt-4 max-w-xs text-sm leading-relaxed">
            Pizza napolitana artesanal desde 2011. Hecha con fuego, tiempo y
            mucho amor.
          </p>
        </div>

        <div>
          <h3 className="font-display text-base font-bold text-cream">Visítanos</h3>
          <address className="mt-4 space-y-1 text-sm not-italic">
            <p>Calle de la Trattoria, 12</p>
            <p>28012 Madrid</p>
            <p className="pt-2">
              <a href="tel:+34910000000" className="hover:text-crust">
                +34 910 000 000
              </a>
            </p>
          </address>
        </div>

        <div>
          <h3 className="font-display text-base font-bold text-cream">Horario</h3>
          <ul className="mt-4 space-y-1 text-sm">
            <li className="flex justify-between gap-4">
              <span>Lun – Jue</span>
              <span className="text-cream/50">13:00 – 23:30</span>
            </li>
            <li className="flex justify-between gap-4">
              <span>Vie – Sáb</span>
              <span className="text-cream/50">13:00 – 00:30</span>
            </li>
            <li className="flex justify-between gap-4">
              <span>Domingo</span>
              <span className="text-cream/50">13:00 – 23:00</span>
            </li>
          </ul>
        </div>

        <div>
          <h3 className="font-display text-base font-bold text-cream">Síguenos</h3>
          <ul className="mt-4 space-y-2 text-sm">
            <li>
              <a href="#" className="hover:text-crust">
                Instagram
              </a>
            </li>
            <li>
              <a href="#" className="hover:text-crust">
                Facebook
              </a>
            </li>
            <li>
              <a href="#" className="hover:text-crust">
                TripAdvisor
              </a>
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-cream/10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-6 py-6 text-xs text-cream/45 sm:flex-row">
          <p>© 2026 Forno Nostro. Todos los derechos reservados.</p>
          <p>Hecho con 🔥 y masa madre.</p>
        </div>
      </div>
    </footer>
  );
}
