// /admin/bolo — Discontinued BOLO list for the aisle. Seed research list
// (lib/bolo/discontinued.ts) plus items Todd adds from a photo (bolo_items,
// lib/bolo/store.ts), each enriched with an eBay thumbnail and live-listing
// numbers from the Browse API (cached 12h). Built phone-first: open the FiA
// Admin app on the home screen, tap BOLO, type a brand — or snap a new one.

import { BOLO_ITEMS, BOLO_RESEARCHED, type BoloItem } from "@/lib/bolo/discontinued";
import { boloReady, listBoloItems, type BoloSaved } from "@/lib/bolo/store";
import { browseSearch, ebayLiveUrl, ebaySoldUrl } from "@/lib/ebay/browse";
import BoloList, { type BoloRow } from "./BoloList";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

async function enrich(it: BoloItem | BoloSaved): Promise<BoloRow> {
  const live = await browseSearch(it.query);
  const prices = (live?.items ?? []).map((h) => h.price).filter((p): p is number => p != null && p > 0);
  const saved = "added" in it ? it : null;
  return {
    id: it.id,
    name: it.name,
    category: it.category,
    query: it.query,
    comp: it.comp,
    kind: it.kind,
    note: it.note,
    source: it.source,
    added: !!saved,
    addedAt: saved?.createdAt ?? null,
    thumb: saved?.photo ?? it.img ?? live?.items.find((h) => h.image)?.image ?? null,
    liveCount: live ? live.total : null,
    liveMedian: median(prices),
    soldUrl: ebaySoldUrl(it.query),
    liveUrl: ebayLiveUrl(it.query),
  };
}

export default async function BoloPage() {
  const [ready, saved] = await Promise.all([boloReady().catch(() => false), listBoloItems().catch(() => [])]);
  const rows: BoloRow[] = await Promise.all([...saved, ...BOLO_ITEMS].map(enrich));
  const apiOk = rows.some((r) => r.liveCount != null);

  return (
    <section className="container-content py-6 md:py-12">
      <p className="text-xs uppercase tracking-wider text-brand-earth mb-2">Sourcing</p>
      <h1 className="font-marker text-3xl md:text-5xl mb-2">Discontinued BOLO</h1>
      <p className="text-sm text-brand-ink/60 mb-5 max-w-3xl">
        Household &amp; beauty products that resell above retail once they leave shelves. Seed comps researched{" "}
        {BOLO_RESEARCHED}; <strong>asking</strong> prices aren&apos;t sales, so tap <em>Sold comps</em> before buying
        deep. Aerosols ship ground-only.
        {apiOk ? " Live counts refresh every 12 hours." : " (Live eBay numbers unavailable right now.)"}
      </p>
      <BoloList rows={rows} canAdd={ready} />
    </section>
  );
}
