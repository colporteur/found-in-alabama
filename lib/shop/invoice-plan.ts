// Which site each package's invoice code pitches (COUPON-2/3), shared by the
// 4 × 6 invoices and the DYMO coupon labels (COUPON-4) so both show the
// same code whichever is printed first. Order of precedence:
//   1. a custom search Todd set on the Ship page (when it still finds items)
//   2. a shelf Todd picked on the Ship page
//   3. automatic: an Alabama address → FIA; else the priciest item's shelf.

import type { ShipOrder } from "@/lib/fulfillment/queue";
import { loadPitchContext, orderLines, planPitch, type PitchContext, type PitchLine, type Site } from "@/lib/shop/invoice-pitch";
import { searchCounter } from "@/lib/shop/invoice-search-server";

export type PlannedPitch = { site: Site; cat: string | null; exact: boolean };

export async function planInvoicePitches(
  orders: Pick<ShipOrder, "id" | "venue" | "pitchCategoryId" | "pitchSearch">[],
  alabama: Set<string>
): Promise<{
  ctx: PitchContext | null;
  lineCats: Map<string, PitchLine[]>;
  picked: Map<string, PlannedPitch>;
  searchCounts: Map<string, number>;
}> {
  const ctx = orders.length ? await loadPitchContext().catch((err) => (console.error("[invoice-plan] pitch context failed", err), null)) : null;
  const lineCats: Map<string, PitchLine[]> = ctx ? await orderLines(orders.map((o) => o.id)).catch(() => new Map()) : new Map();
  const picked = new Map<string, PlannedPitch>(
    orders.map((o) => [
      o.id,
      ctx
        ? planPitch(o.venue, lineCats.get(o.id) ?? [], o.pitchCategoryId, ctx.tesSet, alabama.has(o.id))
        : { site: o.venue === "tes" && !alabama.has(o.id) ? "tes" : "fia", cat: null, exact: false },
    ])
  );
  const countSearch = searchCounter();
  const searchCounts = new Map<string, number>();
  await Promise.all(
    orders.filter((o) => o.pitchSearch).map(async (o) => searchCounts.set(o.id, await countSearch(o.pitchSearch!).catch(() => 0)))
  );
  for (const o of orders) if (o.pitchSearch && (searchCounts.get(o.id) ?? 0) > 0) picked.set(o.id, { site: o.pitchSearch.site, cat: null, exact: true });
  return { ctx, lineCats, picked, searchCounts };
}
