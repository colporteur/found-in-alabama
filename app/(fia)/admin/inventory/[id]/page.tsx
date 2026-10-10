// /admin/inventory/:id — one item: photos, where it's listed, sales, drafts,
// edit history, and the editor for FIA's record (title, bin, status, notes)
// plus cost/haul and an inventory label.

import Link from "next/link";
import { notFound } from "next/navigation";
import { VENUE_NAME, editsReady, loadItem } from "@/lib/inventory/browse";
import { booksReady, itemCost, listAcquisitions } from "@/lib/books/books";
import { HaulCostPanel } from "../../books/BooksControls";
import { ItemEditor } from "./ItemEditor";

export const dynamic = "force-dynamic";

const money = (n: number | null) => (n == null ? "—" : `$${n.toFixed(2)}`);
const when = (s: string | null) =>
  s ? new Date(s.endsWith("Z") || s.includes("+") ? s : `${s}Z`).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" }) : "—";
const FIELD: Record<string, string> = { title: "Title", bin_sku: "Bin", status: "Status", notes: "Notes", sold_on_venue: "Sold on" };

export default async function ItemPage({ params }: { params: { id: string } }) {
  const it = await loadItem(params.id);
  if (!it) notFound();
  const ready = await editsReady();
  const books = (await booksReady().catch(() => false)) ? { cost: await itemCost(it.id), hauls: await listAcquisitions(100) } : null;

  return (
    <section className="container-content py-10">
      <p className="text-xs uppercase tracking-wider text-brand-earth mb-2">
        <Link href="/admin/inventory" className="underline">Inventory</Link> · {it.status}
      </p>
      <h1 className="font-marker text-2xl md:text-3xl mb-1">{it.title}</h1>
      <p className="text-sm text-brand-ink/60 mb-6">
        Bin <span className="font-mono">{it.binSku ?? "—"}</span> · {money(it.price)} · listed {when(it.listedSince)}
        {it.status === "sold" && <> · sold {when(it.soldAt)}{it.soldOnVenue && <> on {VENUE_NAME[it.soldOnVenue] ?? it.soldOnVenue}</>}</>}
      </p>

      <div className="grid lg:grid-cols-3 gap-6 mb-8">
        <div className="lg:col-span-2">
          {it.photos.length > 0 ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mb-6">
              {it.photos.map((u, i) => (
                <a key={i} href={u} target="_blank" rel="noreferrer" className="aspect-square bg-brand-ink/5 rounded flex items-center justify-center overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={u} alt="" loading="lazy" className="object-contain w-full h-full" />
                </a>
              ))}
            </div>
          ) : (
            <p className="text-sm text-brand-ink/50 mb-6">No photos on file.</p>
          )}

          <h2 className="text-xs uppercase tracking-wider text-brand-earth mb-2">Where it&apos;s listed</h2>
          {it.venues.length === 0 ? (
            <p className="text-sm text-brand-ink/60 mb-6">No venue listings known.</p>
          ) : (
            <table className="w-full text-sm mb-6">
              <tbody>
                {it.venues.map((v, i) => (
                  <tr key={i} className="border-t border-brand-ink/10">
                    <td className="py-1.5">{VENUE_NAME[v.venue] ?? v.venue}</td>
                    <td>{v.status === "unknown" ? "listed (not confirmed)" : v.status}</td>
                    <td className="text-right">{v.price != null ? money(v.price) : ""}</td>
                    <td className="text-xs text-brand-ink/50">seen {when(v.lastSeen)}</td>
                    <td className="text-right">{v.url && <a href={v.url} target="_blank" rel="noreferrer" className="underline">open</a>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {it.ebay && (
            <>
              <h2 className="text-xs uppercase tracking-wider text-brand-earth mb-2">eBay</h2>
              <p className="text-sm mb-6">
                <a href={`https://www.ebay.com/itm/${it.ebay.itemId}`} target="_blank" rel="noreferrer" className="underline">{it.ebay.itemId}</a>{" "}
                · {money(it.ebay.price)} · qty {it.ebay.quantity}
                {it.ebay.storeCategory && <> · store: {it.ebay.storeCategory}</>}
                {it.ebay.siteCategory && <> · {it.ebay.siteCategory}</>}
                {it.ebay.shippingProfile && <> · {it.ebay.shippingProfile}</>}
                {it.ebay.weightOz != null && <> · {it.ebay.weightOz} oz</>}
                {it.ebay.title !== it.title && <span className="block text-xs text-brand-ink/60 mt-1">eBay title: {it.ebay.title}</span>}
              </p>
            </>
          )}

          {it.sales.length > 0 && (
            <>
              <h2 className="text-xs uppercase tracking-wider text-brand-earth mb-2">Sales FIA saw</h2>
              <ul className="text-sm mb-6">
                {it.sales.map((s, i) => (
                  <li key={i}>
                    {when(s.soldAt)} · {VENUE_NAME[s.venue] ?? s.venue} · {money(s.price)} · {s.status} ({s.source})
                  </li>
                ))}
              </ul>
            </>
          )}

          {it.drafts.length > 0 && (
            <>
              <h2 className="text-xs uppercase tracking-wider text-brand-earth mb-2">Listing drafts</h2>
              <ul className="text-sm mb-6">
                {it.drafts.map((d) => (
                  <li key={d.id}>
                    <Link href={`/admin/listings/${d.id}`} className="underline">{d.title ?? "(untitled)"}</Link> · {d.status}
                  </li>
                ))}
              </ul>
            </>
          )}

          {it.edits.length > 0 && (
            <>
              <h2 className="text-xs uppercase tracking-wider text-brand-earth mb-2">Edit history</h2>
              <ul className="text-xs text-brand-ink/70 space-y-1 mb-6">
                {it.edits.map((e, i) => (
                  <li key={i}>
                    {when(e.at)} · {FIELD[e.field] ?? e.field}: &ldquo;{e.oldValue ?? "—"}&rdquo; → &ldquo;{e.newValue ?? "—"}&rdquo;
                    {e.by && <> · {e.by}</>}
                  </li>
                ))}
              </ul>
            </>
          )}

          <p className="text-xs text-brand-ink/50">
            Registry id {it.id} · from {it.createdFrom.replace("_", " ")} {it.niftyId && <>· Nifty {it.niftyId}</>}
          </p>
        </div>

        <div className="space-y-4">
          <ItemEditor
            id={it.id}
            title={it.title}
            binSku={it.binSku}
            status={it.status}
            soldOnVenue={it.soldOnVenue}
            notes={it.notes}
            locked={it.locked}
            niftyTitle={it.niftyTitle}
            niftySku={it.niftySku}
            ready={ready}
          />
          {books?.cost && (
            <HaulCostPanel
              registryItemId={it.id}
              hauls={books.hauls.map((h) => ({ id: h.id, name: h.name, acquiredOn: h.acquiredOn }))}
              acquisitionId={books.cost.acquisitionId}
              unitCost={books.cost.unitCost}
              splitCost={books.cost.splitCost}
            />
          )}
          <a
            href={`/admin/labels/print?k=r:${it.id}`}
            target="_blank"
            rel="noreferrer"
            className="inline-block text-sm px-3 py-2 rounded border border-brand-ink/20 hover:border-brand-ink/50"
          >
            Print inventory label
          </a>
        </div>
      </div>
    </section>
  );
}
