// /admin/labels — inventory labels (Phase 4c). Find live items by title or
// bin, or pick from new listings, then print DYMO 57 × 32 mm labels (title,
// logo, price). Replaces the Nifty Inventory Label Printer.

import Link from "next/link";
import { liveBins, recentDrafts, searchInventory } from "@/lib/labels/items";
import { LabelPicker } from "./LabelPicker";

export const dynamic = "force-dynamic";

export default async function LabelsPage({ searchParams }: { searchParams: { q?: string; bin?: string; tab?: string } }) {
  const tab = searchParams.tab === "drafts" ? "drafts" : "inventory";
  const q = (searchParams.q ?? "").slice(0, 120);
  const bin = (searchParams.bin ?? "").slice(0, 40);
  const [items, bins] = await Promise.all([
    tab === "drafts" ? recentDrafts() : searchInventory(q, bin),
    tab === "inventory" ? liveBins() : Promise.resolve([]),
  ]);

  const chip = (on: boolean) =>
    `px-3 py-1 rounded-full border ${on ? "bg-brand-ink text-white border-brand-ink" : "border-brand-ink/20 hover:border-brand-ink/50"}`;

  return (
    <section className="container-content py-12">
      <p className="text-xs uppercase tracking-wider text-brand-earth mb-3">Fulfillment</p>
      <h1 className="font-marker text-4xl md:text-5xl mb-2">Inventory labels</h1>
      <p className="text-sm text-brand-ink/60 mb-6">
        DYMO 57 × 32 mm labels with the title, logo and price. Find live items by title or bin, or label new listings
        at intake.
      </p>

      <div className="flex flex-wrap gap-2 text-sm mb-6">
        <Link href="/admin/labels" className={chip(tab === "inventory")}>
          Inventory
        </Link>
        <Link href="/admin/labels?tab=drafts" className={chip(tab === "drafts")}>
          New listings
        </Link>
      </div>

      {tab === "inventory" && (
        <form className="flex flex-wrap items-end gap-3 mb-6" action="/admin/labels">
          <label className="text-sm">
            <span className="block text-brand-ink/60 mb-1">Title words</span>
            <input name="q" defaultValue={q} className="border rounded px-3 py-2 w-72" placeholder="e.g. Birmingham linen" />
          </label>
          <label className="text-sm">
            <span className="block text-brand-ink/60 mb-1">Bin</span>
            <input name="bin" defaultValue={bin} list="bins" className="border rounded px-3 py-2 w-40 font-mono" placeholder="NA294" />
            <datalist id="bins">
              {bins.map((b) => (
                <option key={b.bin} value={b.bin}>
                  {b.n} item{b.n === 1 ? "" : "s"}
                </option>
              ))}
            </datalist>
          </label>
          <button className="px-4 py-2 rounded bg-brand-ink text-white text-sm">Find</button>
        </form>
      )}

      {tab === "inventory" && !q && !bin ? (
        <p className="text-brand-ink/60 text-sm">Type some title words or a bin to find live items.</p>
      ) : (
        <LabelPicker items={items} />
      )}
    </section>
  );
}
