// /admin/shipping — SHIP-2: envelopes and stamped mail.
//   1. How the sites (FIA, TES) mail things now.
//   2. eBay listings that could use Standard Envelope but don't, with a
//      button that queues the switch (rollback on the batch page).

import Link from "next/link";
import { envelopeCandidates, mailOverview } from "@/lib/shipping/envelope-audit";
import { mailFactsReady } from "@/lib/shipping/mail-refresh";
import { FLAT_ITEM_MAX, SE_ITEM_MAX, MAIL_MAX_PRICE } from "@/lib/shipping/mail";
import { EnvelopeSwitch } from "./EnvelopeSwitch";

export const dynamic = "force-dynamic";

export default async function ShippingPage() {
  if (!(await mailFactsReady())) {
    return (
      <section className="container-content py-12 max-w-3xl">
        <h1 className="font-marker text-4xl mb-4">Shipping</h1>
        <p>Run the migration first (<code>npm run db:migrate</code>, 0052).</p>
      </section>
    );
  }
  const [o, list] = await Promise.all([mailOverview(), envelopeCandidates()]);
  return (
    <section className="container-content py-12 max-w-5xl space-y-8">
      <div>
        <p className="text-xs uppercase tracking-wider text-brand-earth mb-3">Inventory</p>
        <h1 className="font-marker text-4xl md:text-5xl">Envelopes &amp; stamped mail</h1>
        <p className="text-sm text-brand-ink/60 mt-2">
          {o.checkedAt ? `Measurements checked ${new Date(o.checkedAt).toLocaleString("en-US")} (every 15 minutes).` : "Not checked yet — the search-index cron fills this in within 15 minutes of the migration."}
        </p>
      </div>

      <div className="bg-white border border-brand-ink/15 rounded-lg p-5 text-sm space-y-2">
        <h2 className="font-medium">On foundinalabama.com and theephemeralstate.com</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <b>{o.onEnvelope.toLocaleString()}</b> listings on eBay Standard Envelope ship as an <b>envelope</b> on the sites
            (TES paper rate; FIA <Link className="underline" href="/admin/fia-shop">envelope price</Link>), whatever their store
            shelf.
          </li>
          <li>
            <b>{o.stampOkNotEnvelope.toLocaleString()}</b> more are <b>stamped flats</b>: flat paper ${MAIL_MAX_PRICE} or less that
            fits a 12×15 USPS large envelope (item up to {FLAT_ITEM_MAX.short}×{FLAT_ITEM_MAX.long} in, with a stiffener that
            still bends).
          </li>
          <li>
            <b>{o.paperNoSize.toLocaleString()}</b> paper listings at ${MAIL_MAX_PRICE} or less have no size FIA can read
            (not measured, no size in the title, not a standard format), so they keep parcel shipping.
          </li>
        </ul>
      </div>

      <div className="bg-white border border-brand-ink/15 rounded-lg p-5 text-sm space-y-3">
        <h2 className="font-medium">eBay: could use Standard Envelope ({list.length})</h2>
        <p className="text-brand-ink/70">
          Live listings, ${MAIL_MAX_PRICE} or less, in a category on eBay&apos;s Standard Envelope list, that fit the envelope
          (item up to {SE_ITEM_MAX.short}×{SE_ITEM_MAX.long} in; at most 3 postcards or 24 raw cards; nothing graded, framed or
          rigid) but ship another way. The switch moves them to your envelope policy with 1 oz package details, one listing at a
          time, and each can be undone from the batch page.
        </p>
        <EnvelopeSwitch list={list} />
      </div>
    </section>
  );
}
