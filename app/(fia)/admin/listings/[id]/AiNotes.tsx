// What the listing writer used and decided (Phase LIST-2): model and tier,
// confidence, cost, guides, price reasoning, supply snapshot and flags.

type Meta = Record<string, unknown>;
type Stats = { n: number; min: number; median: number; max: number } | null;

const SHIP_LABEL: Record<string, string> = {
  envelope: "Standard Envelope",
  calculated: "Calculated",
  media: "Media Mail",
};

const money = (v: unknown) => (typeof v === "number" ? `$${v.toFixed(2)}` : "—");

export function AiNotes({
  meta,
  shippingProfile,
  venuePrices,
}: {
  meta: Meta;
  shippingProfile: string | null;
  venuePrices: Record<string, number> | null;
}) {
  const conf = typeof meta.confidence === "number" ? Math.round(meta.confidence * 100) : null;
  const guides = (meta.guides as Array<{ id: string; name: string; version: string | null }> | undefined) ?? [];
  const flags = (meta.flags as string[] | undefined) ?? [];
  const priceNotes = (meta.priceNotes as string[] | undefined) ?? [];
  const attempts = (meta.attempts as Array<{ tier: string; model: string; confidence: number | null; error: string | null }> | undefined) ?? [];
  const supply = meta.supply as
    | { q: string; band: string; same: Stats; similar: Stats; items?: Array<{ title: string; total: number; cls: string }> }
    | null
    | undefined;
  const ident = meta.identification as { identification?: string; kind?: string; era?: string } | null | undefined;
  const st = (s: Stats) => (s ? `${s.n} · median $${s.median} (${s.min}–${s.max})` : "none");

  return (
    <div className="grid gap-4 md:grid-cols-3 mb-8 text-sm">
      <div className="bg-brand-ink/[0.03] border border-brand-ink/10 rounded-lg p-4 space-y-1">
        <h2 className="text-xs uppercase tracking-wider text-brand-earth mb-2">Writer</h2>
        <p>
          <span className="text-brand-ink/60">Model:</span> {String(meta.model ?? "—")}{" "}
          <span className="text-brand-ink/60">({String(meta.tier ?? "?")} — {String(meta.tierReason ?? "")})</span>
        </p>
        {attempts.length > 1 && (
          <p className="text-xs text-brand-ink/60">
            Tried: {attempts.map((a) => `${a.tier}${a.confidence != null ? ` ${Math.round(a.confidence * 100)}%` : a.error ? " failed" : ""}`).join(" → ")}
          </p>
        )}
        <p>
          <span className="text-brand-ink/60">Confidence:</span>{" "}
          <span className={conf != null && conf < 60 ? "text-red-800 font-medium" : ""}>{conf != null ? `${conf}%` : "—"}</span>
          {" · "}
          <span className="text-brand-ink/60">Cost:</span> ${Number(meta.costUsd ?? 0).toFixed(3)}
        </p>
        {ident?.identification && (
          <p>
            <span className="text-brand-ink/60">First look:</span> {ident.identification}
          </p>
        )}
        <p>
          <span className="text-brand-ink/60">Guides:</span>{" "}
          {guides.length ? guides.map((g) => `${g.name}${g.version ? ` (v${g.version})` : ""}`).join(", ") : "none matched"}
        </p>
        {typeof meta.categorySuggestion === "string" && meta.categorySuggestion && (
          <p className="text-xs">
            <span className="text-brand-ink/60">Category isn&apos;t one the store uses yet — suggested:</span> {meta.categorySuggestion}
          </p>
        )}
      </div>

      <div className="bg-brand-ink/[0.03] border border-brand-ink/10 rounded-lg p-4 space-y-1">
        <h2 className="text-xs uppercase tracking-wider text-brand-earth mb-2">Price</h2>
        <p>
          <span className="text-brand-ink/60">Suggested:</span> {money(meta.priceSuggested)}{" "}
          <span className="text-brand-ink/60">(range {money(meta.priceLow)}–{money(meta.priceHigh)})</span>
        </p>
        {meta.priceRationale ? <p>{String(meta.priceRationale)}</p> : null}
        {priceNotes.length > 0 && <p className="text-xs text-brand-ink/60">Rules: {priceNotes.join("; ")}</p>}
        {venuePrices?.poshmark != null && <p className="text-xs">Poshmark: ${venuePrices.poshmark}</p>}
        <p className="text-xs">
          <span className="text-brand-ink/60">Shipping:</span> {shippingProfile ? SHIP_LABEL[shippingProfile] ?? shippingProfile : "—"}
          {meta.shippingReason ? <> ({String(meta.shippingReason)})</> : null}
        </p>
      </div>

      <div className="bg-brand-ink/[0.03] border border-brand-ink/10 rounded-lg p-4 space-y-1">
        <h2 className="text-xs uppercase tracking-wider text-brand-earth mb-2">Supply & flags</h2>
        {supply ? (
          <>
            <p>
              <span className="text-brand-ink/60">Active on eBay:</span> {supply.band.toUpperCase()} for “{supply.q}”
            </p>
            <p className="text-xs text-brand-ink/60">Same item: {st(supply.same)} · similar: {st(supply.similar)}</p>
            {(supply.items ?? []).length > 0 && (
              <ul className="text-xs list-disc pl-4">
                {(supply.items ?? []).map((i, k) => (
                  <li key={k}>
                    ${i.total} — {i.title}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="text-brand-ink/60">No supply snapshot.</p>
        )}
        {flags.length > 0 && (
          <ul className="text-xs list-disc pl-4 text-red-900 pt-2">
            {flags.map((f, k) => (
              <li key={k}>{f}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
