// /admin/ship — the to-ship queue (Phase 4a). Every sale on every venue
// since the start date, one row per package, from pick → packed → shipped.
// Replaces the Nifty Pick List's "Include up to here"; Nifty is not read.

import Link from "next/link";
import {
  SHIP_TABS,
  fulfillmentSettings,
  loadShipQueue,
  shipTablesReady,
  syncShipQueue,
  type ShipTab,
} from "@/lib/fulfillment/queue";
import { ShipTable, StartForm, SyncButton } from "./ShipControls";
import { FULFILLMENT_SCOPE, hasGrantedScope } from "@/lib/ebay/oauth";

export const dynamic = "force-dynamic";

const TAB_LABEL: Record<ShipTab, string> = {
  to_pick: "To pick",
  packed: "Packed",
  shipped: "Shipped (30 days)",
  cancelled: "Cancelled (30 days)",
};

export default async function ShipPage({ searchParams }: { searchParams: { tab?: string } }) {
  if (!(await shipTablesReady())) {
    return (
      <section className="container-content py-12 max-w-3xl">
        <h1 className="font-marker text-4xl mb-4">To ship</h1>
        <p className="text-brand-ink/80">
          The shipping tables don&apos;t exist yet. Run the migration (<code>npm run db:migrate</code>).
        </p>
      </section>
    );
  }

  const settings = await fulfillmentSettings();
  if (!settings.startDate) {
    return (
      <section className="container-content py-12 max-w-3xl">
        <p className="text-xs uppercase tracking-wider text-brand-earth mb-3">Fulfillment</p>
        <h1 className="font-marker text-4xl mb-4">To ship</h1>
        <p className="text-brand-ink/80 mb-6">
          Pick the first day of sales this queue should cover. Sales before it never show up here, so pick a
          day you haven&apos;t packed yet through Nifty.
        </p>
        <StartForm />
      </section>
    );
  }

  const sync = await syncShipQueue().catch((err) => {
    console.error("[ship] sync failed", err);
    return null;
  });
  const ebayAccess = await hasGrantedScope(FULFILLMENT_SCOPE).catch(() => false);
  const tab: ShipTab = SHIP_TABS.includes(searchParams.tab as ShipTab) ? (searchParams.tab as ShipTab) : "to_pick";
  const { orders, counts } = await loadShipQueue(tab);

  return (
    <section className="container-content py-12">
      <p className="text-xs uppercase tracking-wider text-brand-earth mb-3">Fulfillment</p>
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="font-marker text-4xl md:text-5xl">To ship</h1>
          <p className="text-sm text-brand-ink/60 mt-2">
            Every venue&apos;s sales since {settings.startDate}, from sale detection. Website and Hip orders mark
            themselves shipped from the TES orders page; mark the rest here.
          </p>
        </div>
        <SyncButton />
      </div>

      {!ebayAccess && (
        <div className="mb-6 rounded border border-amber-300 bg-amber-50 p-4 text-sm">
          <strong>Connect eBay order access</strong> so eBay packages show the buyer and ship-to, group eBay&apos;s
          combined orders, and mark themselves shipped. It&apos;s read-only. Open{" "}
          <Link href="/admin/ebay/sales/connect" className="underline">eBay connection</Link> and click Connect
          (or Reconnect), then approve on eBay.
        </div>
      )}
      {sync?.ebayError && (
        <div className="mb-6 rounded border border-red-300 bg-red-50 p-3 text-sm">
          Couldn&apos;t read eBay orders: {sync.ebayError}
        </div>
      )}

      <div className="flex flex-wrap gap-2 text-sm mb-6">
        {SHIP_TABS.map((t) => (
          <Link
            key={t}
            href={t === "to_pick" ? "/admin/ship" : `/admin/ship?tab=${t}`}
            className={`px-3 py-1 rounded-full border ${
              t === tab ? "bg-brand-ink text-white border-brand-ink" : "border-brand-ink/20 hover:border-brand-ink/50"
            }`}
          >
            {TAB_LABEL[t]} ({counts[t] ?? 0})
          </Link>
        ))}
      </div>

      <ShipTable orders={orders} tab={tab} startDate={settings.startDate} />
    </section>
  );
}
