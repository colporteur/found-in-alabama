// /admin/listings/settings — which model writes each tier, how many photos
// it sees, when it retries one tier up, and the price floors (LIST-2).

import Link from "next/link";
import { writerSettings } from "@/lib/listings/writer";
import { DEFAULT_WRITER_SETTINGS } from "@/lib/listings/rules";
import { SettingsForm } from "./SettingsForm";
import { TemplatesForm } from "./TemplatesForm";
import { niftyTemplates, DEFAULT_TEMPLATES, TEMPLATE_LABELS } from "@/lib/listings/nifty";
import { ebaySettings } from "@/lib/ebay/publish-settings";
import { EbayPublishSwitch } from "./EbayPublishSwitch";

export const dynamic = "force-dynamic";

export default async function WriterSettingsPage() {
  const s = await writerSettings();
  const templates = await niftyTemplates();
  const ebay = await ebaySettings().catch(() => ({ enabled: false, cardsDirect: true }));
  return (
    <section className="container-content py-12 max-w-3xl">
      <p className="text-xs uppercase tracking-wider text-brand-earth mb-3">
        <Link href="/admin/listings" className="underline">
          Listings
        </Link>{" "}
        · settings
      </p>
      <h1 className="font-marker text-4xl mb-4">Listing writer</h1>
      <p className="text-sm text-brand-ink/70 mb-6">
        A quick first look (the identify model) decides how hard each item is. Common postcards and simple paper go to the
        Simple model; most items to General; artwork, signed, valuable (≈$75+) or hard items to Premium. When the writer is less
        sure than the retry threshold, it tries once more one tier up. Model names are OpenRouter ids (e.g.{" "}
        <code>anthropic/claude-sonnet-5</code>) or aliases from Admin → AI Models.
      </p>
      <SettingsForm initial={s} defaults={DEFAULT_WRITER_SETTINGS} />

      <h2 className="font-marker text-2xl mt-12 mb-2">Nifty templates</h2>
      <p className="text-sm text-brand-ink/70 mb-4">
        When an approved draft goes to Nifty, its shipping, return and payment policies, Mercari / Depop / Whatnot shipping,
        Poshmark size and the other marketplaces&apos; categories are copied from one of these existing Nifty listings. The title,
        description, condition, prices, photos, eBay category, item specifics and store categories come from the draft.
      </p>
      <TemplatesForm initial={templates} defaults={DEFAULT_TEMPLATES} labels={TEMPLATE_LABELS} />

      <h2 className="font-marker text-2xl mt-12 mb-2">Publish straight to eBay (pilot)</h2>
      <p className="text-sm text-brand-ink/70 mb-4">
        Adds a panel to approved drafts: <strong>Check with eBay</strong> (eBay&apos;s dry run, nothing is created), then{" "}
        <strong>Publish to eBay</strong>. Payment and return policies, location, handling time, Best Offer and package size are
        copied from your newest eBay listing with the same kind of shipping policy. Afterwards, import it into Nifty to crosslist.
        Sending to Nifty keeps working as before. Turning this off just hides the panel.
      </p>
      <EbayPublishSwitch initial={ebay.enabled} />

      <h2 className="font-marker text-2xl mt-12 mb-2">Single trading cards</h2>
      <p className="text-sm text-brand-ink/70 mb-4">
        eBay wants a card condition on single cards (Graded with the grader and grade, or Ungraded with Near Mint or Better /
        Excellent / Very Good / Poor). Nifty can&apos;t send that, so single cards fail there. With this on, approved single cards
        (eBay categories Trading Card Singles and CCG Individual Cards) skip <strong>Send approved to Nifty</strong> and wait on
        the Listings page for <strong>Publish to eBay</strong>. Lots still go to Nifty. Any one draft can be switched to the
        other road on its page.
      </p>
      <EbayPublishSwitch initial={ebay.cardsDirect} field="cardsDirect">
        Send single trading cards <strong>straight to eBay</strong> instead of Nifty
      </EbayPublishSwitch>
    </section>
  );
}
