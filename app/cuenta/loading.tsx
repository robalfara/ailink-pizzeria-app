export default function CargandoCuenta() {
  return (
    <div className="animate-pulse">
      <div className="mb-8 space-y-2">
        <div className="h-9 w-56 rounded-lg bg-charcoal/10" />
        <div className="h-4 w-72 rounded bg-charcoal/5" />
      </div>

      <div className="space-y-5 rounded-2xl border border-charcoal/10 bg-cream p-8">
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-1.5">
            <div className="h-4 w-20 rounded bg-charcoal/10" />
            <div className="h-10 w-full rounded-lg bg-charcoal/5" />
          </div>
        ))}
        <div className="h-10 w-full rounded-full bg-charcoal/10" />
      </div>
    </div>
  );
}
