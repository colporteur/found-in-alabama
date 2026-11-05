"use client";

import { useMemo, useState } from "react";
import type { BoloCategory, BoloItem } from "@/lib/bolo/discontinued";

export type BoloRow = BoloItem & {
  thumb: string | null;
  liveCount: number | null;
  liveMedian: number | null;
  soldUrl: string;
  liveUrl: string;
};

const CATS: Array<BoloCategory | "All"> = [
  "All",
  "Cleaners & polish",
  "Air fresheners",
  "Bar soap",
  "Hair care",
  "Fragrance",
  "Traps",
];

const KIND_STYLE: Record<BoloRow["kind"], string> = {
  sold: "bg-green-100 text-green-800",
  asking: "bg-amber-100 text-amber-800",
  retail: "bg-red-100 text-red-800",
};
const KIND_LABEL: Record<BoloRow["kind"], string> = { sold: "Sold", asking: "Asking", retail: "Retail" };

export default function BoloList({ rows }: { rows: BoloRow[] }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<BoloCategory | "All">("All");

  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return rows.filter((r) => {
      if (cat !== "All" && r.category !== cat) return false;
      if (cat === "All" && r.category === "Traps" && !words.length) return false;
      const hay = `${r.name} ${r.note ?? ""} ${r.query} ${r.category}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [rows, q, cat]);

  return (
    <div>
      <div className="sticky top-0 z-10 bg-brand-paper pb-3 pt-1">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Brand or product — pledge, dial, glade…"
          className="w-full border border-brand-ink/20 rounded-lg px-4 py-3 text-base bg-white mb-3"
          autoComplete="off"
          autoCapitalize="off"
        />
        <div className="flex gap-2 overflow-x-auto pb-1 text-sm -mx-1 px-1">
          {CATS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCat(c)}
              className={`shrink-0 px-3 py-1.5 rounded-full border ${
                c === cat ? "bg-brand-ink text-white border-brand-ink" : "bg-white border-brand-ink/20"
              } ${c === "Traps" && c !== cat ? "text-red-700" : ""}`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <p className="text-xs text-brand-ink/50 mb-3">
        {shown.length} of {rows.length}
        {cat === "All" && !q ? " · Traps hidden (tap Traps to see what not to pay up for)" : ""}
      </p>

      <ul className="grid gap-3 md:grid-cols-2">
        {shown.map((r) => (
          <li
            key={r.id}
            className={`bg-white border rounded-lg p-3 flex gap-3 ${
              r.category === "Traps" ? "border-red-200" : "border-brand-ink/15"
            }`}
          >
            <a href={r.liveUrl} target="_blank" rel="noopener noreferrer" className="shrink-0">
              {r.thumb ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={r.thumb}
                  alt=""
                  loading="lazy"
                  className="w-20 h-20 md:w-24 md:h-24 object-contain rounded bg-brand-paper border border-brand-ink/10"
                />
              ) : (
                <div className="w-20 h-20 md:w-24 md:h-24 rounded bg-brand-paper border border-brand-ink/10 flex items-center justify-center text-xs text-brand-ink/40 text-center p-1">
                  no photo
                </div>
              )}
            </a>
            <div className="min-w-0 flex-1">
              <p className="font-medium leading-snug">{r.name}</p>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold">{r.comp}</span>
                <span className={`text-[11px] uppercase tracking-wide px-1.5 py-0.5 rounded ${KIND_STYLE[r.kind]}`}>
                  {KIND_LABEL[r.kind]}
                </span>
              </p>
              {r.liveCount != null && (
                <p className="text-xs text-brand-ink/60 mt-1">
                  {r.liveCount.toLocaleString()} live on eBay
                  {r.liveMedian != null ? ` · typical ask $${r.liveMedian.toFixed(2)}` : ""}
                </p>
              )}
              {r.note && <p className="text-sm text-brand-ink/70 mt-1 leading-snug">{r.note}</p>}
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                <a href={r.soldUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 decoration-brand-yellow decoration-2">
                  Sold comps
                </a>
                <a href={r.liveUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 decoration-brand-yellow decoration-2">
                  Live listings
                </a>
                {r.source && (
                  <a href={r.source} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 text-brand-ink/60">
                    Source
                  </a>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {!shown.length && <p className="text-sm text-brand-ink/60 mt-6">Nothing on the list matches — not a BOLO (yet).</p>}
    </div>
  );
}
