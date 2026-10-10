// /admin/inventory — the inventory browser: every registry item, searchable
// and filterable like Nifty's inventory page (status tabs with counts, venue,
// bin, price, listed date), as a table or a photo grid. Click an item to
// edit FIA's record of it.

import Link from "next/link";
import {
  SORTS,
  STATUS_TABS,
  VENUE_NAME,
  VENUES,
  browseHref,
  browseInventory,
  parseBrowseQuery,
  type BrowseItem,
} from "@/lib/inventory/browse";

export const dynamic = "force-dynamic";

const money = (n: number | null) => (n == null ? "—" : `$${n.toFixed(2)}`);
const day = (s: string | null) =>
  s ? new Date(s.endsWith("Z") || s.includes("+") ? s : `${s}Z`).toLocaleDateString("en-US", { timeZone: "America/Chicago", dateStyle: "medium" }) : "";

const STATUS_STYLE: Record<string, string> = {
  live: "bg-green-100 text-green-900",
  sold: "bg-blue-100 text-blue-900",
  archived: "bg-gray-200 text-gray-700",
  draft: "bg-amber-100 text-amber-900",
};
const STATUS_LABEL: Record<string, string> = { live: "Active", sold: "Sold", archived: "Delisted", draft: "Draft", shipped: "Shipped" };

const SHORT: Record<string, string> = { ebay: "eB", mercari: "Me", poshmark: "Po", depop: "De", whatnot: "Wn", hip: "Hip", etsy: "Et" };

function VenueChips({ item }: { item: BrowseItem }) {
  return (
    <span className="flex flex-wrap gap-1">
      {item.venues.map((v, i) => (
        <a
          key={i}
          href={v.url ?? undefined}
          target="_blank"
          rel="noreferrer"
          title={`${VENUE_NAME[v.venue] ?? v.venue}: ${v.status === "unknown" ? "listed (status not confirmed)" : v.status}`}
          className={`text-[10px] px-1 rounded border ${
            v.status === "live" ? "border-green-600 text-green-800" : v.status === "sold" ? "border-blue-600 text-blue-800 bg-blue-50" : "border-brand-ink/30 text-brand-ink/60"
          }`}
        >
          {SHORT[v.venue] ?? v.venue}
        </a>
      ))}
    </span>
  );
}

export default async function InventoryPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const q = parseBrowseQuery(searchParams);
  const r = await browseInventory(q);
  const pages = Math.max(1, Math.ceil(r.total / r.pageSize));
  const firstShown = r.total ? (q.page - 1) * r.pageSize + 1 : 0;
  const lastShown = Math.min(r.total, q.page * r.pageSize);
  const filtered = q.q || q.venue || q.bin || q.minPrice != null || q.maxPrice != null || q.from || q.to;

  return (
    <section className="container-content py-10">
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-6">
        <div>
          <p className="text-xs uppercase tracking-wider text-brand-earth mb-1">Inventory</p>
          <h1 className="font-marker text-3xl md:text-4xl">Inventory browser</h1>
        </div>
        <div className="text-sm flex gap-3">
          <Link href={browseHref(q, { view: "table", page: 1 })} className={q.view === "table" ? "font-semibold underline" : "text-brand-ink/60"}>
            Table
          </Link>
          <Link href={browseHref(q, { view: "grid", page: 1 })} className={q.view === "grid" ? "font-semibold underline" : "text-brand-ink/60"}>
            Photos
          </Link>
        </div>
      </div>

      <form method="get" action="/admin/inventory" className="bg-white border border-brand-ink/15 rounded-lg p-4 mb-4 grid gap-3 md:grid-cols-6 text-sm">
        <input type="hidden" name="status" value={q.status} />
        <input type="hidden" name="view" value={q.view} />
        <label className="md:col-span-2">
          <span className="block text-xs text-brand-ink/60 mb-1">Search</span>
          <input name="q" defaultValue={q.q ?? ""} placeholder="Title words, bin, or listing id" className="w-full border rounded px-2 py-1.5" />
        </label>
        <label>
          <span className="block text-xs text-brand-ink/60 mb-1">Venue</span>
          <select name="venue" defaultValue={q.venue ?? ""} className="w-full border rounded px-2 py-1.5">
            <option value="">Any</option>
            {VENUES.map((v) => (
              <option key={`on${v}`} value={`on:${v}`}>On {VENUE_NAME[v]}</option>
            ))}
            {VENUES.filter((v) => v !== "etsy").map((v) => (
              <option key={`off${v}`} value={`off:${v}`}>Not on {VENUE_NAME[v]}</option>
            ))}
            <option value="none">Listed nowhere</option>
          </select>
        </label>
        <label>
          <span className="block text-xs text-brand-ink/60 mb-1">Bin (LT* for a prefix)</span>
          <input name="bin" defaultValue={q.bin ?? ""} className="w-full border rounded px-2 py-1.5" />
        </label>
        <div>
          <span className="block text-xs text-brand-ink/60 mb-1">Price</span>
          <div className="flex gap-1">
            <input name="min" defaultValue={q.minPrice ?? ""} placeholder="min" inputMode="decimal" className="w-1/2 border rounded px-2 py-1.5" />
            <input name="max" defaultValue={q.maxPrice ?? ""} placeholder="max" inputMode="decimal" className="w-1/2 border rounded px-2 py-1.5" />
          </div>
        </div>
        <label>
          <span className="block text-xs text-brand-ink/60 mb-1">Sort</span>
          <select name="sort" defaultValue={q.sort} className="w-full border rounded px-2 py-1.5">
            {Object.entries(SORTS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </label>
        <div className="md:col-span-2">
          <span className="block text-xs text-brand-ink/60 mb-1">Listed between</span>
          <div className="flex gap-1 items-center">
            <input type="date" name="from" defaultValue={q.from ?? ""} className="border rounded px-2 py-1" />
            <span>–</span>
            <input type="date" name="to" defaultValue={q.to ?? ""} className="border rounded px-2 py-1" />
          </div>
        </div>
        <div className="md:col-span-4 flex items-end gap-3">
          <button className="px-4 py-1.5 rounded bg-brand-ink text-white">Search</button>
          {filtered && (
            <Link href={browseHref({ ...q, q: null, venue: null, bin: null, minPrice: null, maxPrice: null, from: null, to: null, page: 1 })} className="text-brand-ink/60 underline">
              Clear filters
            </Link>
          )}
        </div>
      </form>

      <div className="flex flex-wrap gap-2 text-sm mb-4">
        {STATUS_TABS.map((t) => (
          <Link
            key={t.key}
            href={browseHref(q, { status: t.key, page: 1, sort: t.key === "sold" && q.sort === "newest" ? "sold_recent" : q.sort })}
            className={`px-3 py-1 rounded-full border ${t.key === q.status ? "bg-brand-ink text-white border-brand-ink" : "border-brand-ink/20 hover:border-brand-ink/50"}`}
          >
            {t.label} <span className="opacity-70">{(r.counts[t.key] ?? 0).toLocaleString()}</span>
          </Link>
        ))}
      </div>

      <p className="text-xs text-brand-ink/60 mb-3">
        {r.total ? `${firstShown.toLocaleString()}–${lastShown.toLocaleString()} of ${r.total.toLocaleString()}` : "Nothing matches."}{" "}
        Venue chips: green = live, blue = sold there, gray = listed (status not confirmed by Nifty yet).
      </p>

      {q.view === "grid" ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-6 gap-3">
          {r.items.map((it) => (
            <Link key={it.id} href={`/admin/inventory/${it.id}`} className="bg-white border border-brand-ink/10 rounded-lg overflow-hidden hover:border-brand-ink/40 block">
              <div className="aspect-square bg-brand-ink/5 flex items-center justify-center">
                {it.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={it.imageUrl} alt="" loading="lazy" className="object-contain w-full h-full" />
                ) : (
                  <span className="text-xs text-brand-ink/40">no photo</span>
                )}
              </div>
              <div className="p-2 text-xs">
                <p className="line-clamp-2 mb-1">{it.title}</p>
                <p className="flex justify-between text-brand-ink/60">
                  <span>{it.binSku ?? "—"}</span>
                  <span className="font-semibold text-brand-ink">{money(it.price)}</span>
                </p>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto bg-white border border-brand-ink/10 rounded-lg">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-brand-ink/60 border-b border-brand-ink/10">
                <th className="p-2"></th>
                <th className="p-2">Item</th>
                <th className="p-2">Bin</th>
                <th className="p-2 text-right">Price</th>
                <th className="p-2">Venues</th>
                <th className="p-2">{q.status === "sold" ? "Sold" : "Listed"}</th>
                <th className="p-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {r.items.map((it) => (
                <tr key={it.id} className="border-t border-brand-ink/5 hover:bg-brand-ink/[0.02]">
                  <td className="p-2 w-14">
                    {it.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={it.imageUrl} alt="" loading="lazy" className="w-12 h-12 object-cover rounded" />
                    ) : (
                      <span className="block w-12 h-12 rounded bg-brand-ink/5" />
                    )}
                  </td>
                  <td className="p-2">
                    <Link href={`/admin/inventory/${it.id}`} className="hover:underline">{it.title}</Link>
                    {it.edited && <span className="ml-1 text-[10px] text-brand-earth" title="Edited in FIA">✎</span>}
                  </td>
                  <td className="p-2 font-mono text-xs whitespace-nowrap">
                    {it.binSku ? <Link href={browseHref(q, { bin: it.binSku, page: 1 })} className="hover:underline">{it.binSku}</Link> : "—"}
                  </td>
                  <td className="p-2 text-right whitespace-nowrap">{money(it.price)}</td>
                  <td className="p-2"><VenueChips item={it} /></td>
                  <td className="p-2 whitespace-nowrap text-xs text-brand-ink/70">
                    {it.status === "sold" ? <>{day(it.soldAt)}{it.soldOnVenue && <> · {VENUE_NAME[it.soldOnVenue] ?? it.soldOnVenue}</>}</> : day(it.listedSince)}
                  </td>
                  <td className="p-2">
                    <span className={`text-xs px-1.5 py-0.5 rounded ${STATUS_STYLE[it.status] ?? "bg-gray-100"}`}>{STATUS_LABEL[it.status] ?? it.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-center gap-4 mt-6 text-sm">
          {q.page > 1 ? <Link href={browseHref(q, { page: q.page - 1 })} className="underline">← Previous</Link> : <span className="text-brand-ink/30">← Previous</span>}
          <span>Page {q.page} of {pages.toLocaleString()}</span>
          {q.page < pages ? <Link href={browseHref(q, { page: q.page + 1 })} className="underline">Next →</Link> : <span className="text-brand-ink/30">Next →</span>}
        </div>
      )}
    </section>
  );
}
