// /admin/ship/pick?ids=… — printable pick list for the chosen packages,
// sorted the way the shelves are walked (lib/fulfillment/sku.ts — same rules
// as the Nifty Pick List). Printing records pick_printed_at.

import { loadShipOrders } from "@/lib/fulfillment/queue";
import { buildPickSections } from "@/lib/fulfillment/sku";
import { PrintBar } from "./PrintBar";

export const dynamic = "force-dynamic";

const VENUE: Record<string, string> = {
  ebay: "eBay",
  mercari: "Mercari",
  poshmark: "Poshmark",
  depop: "Depop",
  whatnot: "Whatnot",
  hip: "Hip",
  tes: "TES",
  fia: "FIA",
};

type PickItem = { key: string; title: string; sku: string; qty: number; venue: string; img: string | null; multi: boolean };

export default async function PickListPage({ searchParams }: { searchParams: { ids?: string } }) {
  const ids = (searchParams.ids ?? "").split(",").filter(Boolean);
  const orders = await loadShipOrders(ids);
  const items: PickItem[] = orders.flatMap((o) =>
    o.lines.map((l) => ({
      key: l.id,
      title: l.title ?? "(no title)",
      sku: l.binSku ?? "",
      qty: l.quantity,
      venue: VENUE[o.venue] ?? o.venue,
      img: l.imageUrl,
      multi: o.lines.length > 1,
    }))
  );
  const sections = buildPickSections(items, (i) => i.sku);
  const printed = new Date().toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" });

  return (
    <section className="pick-page container-content py-6">
      <style>{`
        @media print {
          body header, body footer, body nav, .no-print { display: none !important; }
          .pick-page { padding: 0 !important; max-width: none !important; }
          .pick-group { break-inside: avoid; }
          @page { margin: 0.4in; }
        }
        .hide-thumbs .pick-thumb { display: none; }
        .hide-venue .pick-venue { display: none; }
      `}</style>

      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-4">
        <h1 className="text-2xl font-bold">Pick list</h1>
        <span className="text-sm text-brand-ink/60">
          {items.length} item{items.length === 1 ? "" : "s"} · {orders.length} package{orders.length === 1 ? "" : "s"} · {printed}
        </span>
      </div>

      <PrintBar ids={orders.map((o) => o.id)} />

      {!items.length && <p className="text-brand-ink/60">No packages selected.</p>}

      <div id="pick-root">
        {sections.map((s) => (
          <div key={s.type} className="mb-6">
            <h2 className="text-lg font-semibold border-b-2 border-brand-ink mb-1">
              {s.title} <span className="text-sm font-normal text-brand-ink/60">— {s.count} item{s.count === 1 ? "" : "s"}, {s.groups.length} group{s.groups.length === 1 ? "" : "s"} · {s.note}</span>
            </h2>
            {s.groups.map((g) => (
              <div key={g.name} className="pick-group mb-3">
                <div className="flex justify-between text-sm font-semibold bg-brand-ink/5 px-2 py-1">
                  <span>{g.name}</span>
                  <span className="font-normal text-brand-ink/60">{g.items.length === 1 ? "1 item" : `${g.items.length} items`}</span>
                </div>
                <table className="w-full text-sm">
                  <tbody>
                    {g.items.map((i) => (
                      <tr key={i.key} className="border-b border-brand-ink/10 align-middle">
                        <td className="w-7 py-1">
                          <span className="inline-block w-4 h-4 border-2 border-brand-ink rounded-sm" />
                        </td>
                        <td className="pick-thumb w-14 py-1">
                          {i.img ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={i.img} alt="" className="w-12 h-12 object-cover" loading="eager" />
                          ) : (
                            <div className="w-12 h-12 bg-brand-ink/10" />
                          )}
                        </td>
                        <td className="py-1 pr-3">
                          {i.title}
                          {i.multi && <span className="ml-1 text-xs text-brand-ink/60">(part of a multi-item order)</span>}
                        </td>
                        <td className="py-1 pr-3 font-mono whitespace-nowrap">{i.sku}</td>
                        <td className="py-1 pr-3 text-center whitespace-nowrap font-semibold">{i.qty}</td>
                        <td className="pick-venue py-1 whitespace-nowrap">{i.venue}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
