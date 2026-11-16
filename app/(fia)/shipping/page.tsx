// Shipping policy for foundinalabama.com. Prices come from the same
// settings the cart and checkout use (/admin/fia-shop), so the page tracks
// whatever Todd sets there. Merchant Center wants cost, handling time and
// destinations stated on the store's own domain.

import type { Metadata } from "next";
import Link from "next/link";
import FiaPolicyPage, { FiaSection, fiaLink } from "@/components/fia/FiaPolicyPage";
import { getFiaShipSettings } from "@/lib/fia/settings";
import { BUSINESS, FIA_EMAIL } from "@/lib/business";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Shipping",
  description:
    "Shipping for Found in Alabama: stamped envelopes for small paper, USPS Media Mail for books, USPS Ground Advantage for everything else. Combined shipping, US addresses only.",
  alternates: { canonical: "/shipping" },
};

const fmt = (n: number) => `$${n.toFixed(2)}`;

export default async function FiaShippingPage() {
  const s = await getFiaShipSettings();
  const lowest = (t: { price: number }[]) =>
    t.length > 0 ? Math.min(...t.map((r) => r.price)) + s.handling : null;
  const ground = lowest(s.groundTable);
  const media = lowest(s.mediaTable);
  const maxLb = Math.round(s.maxItemWeightOz / 16);

  return (
    <FiaPolicyPage
      eyebrow="Shipping"
      title="How your order gets to you."
      intro={`We pack every order by hand and ship it by USPS from ${BUSINESS.shipsFrom}. Every item page shows its shipping cost before you add it to your cart.`}
    >
      <FiaSection heading="What it costs">
        <ul className="list-disc ml-5 space-y-2">
          <li>
            <span className="font-medium">Postcards and small paper:</span>{" "}
            {fmt(s.envelopePrice)} in a stamped envelope, or {fmt(s.flatPrice)}{" "}
            in a stiffened 12&times;15 flat, plus {fmt(s.mailAdditional)} for
            each extra piece. These go First-Class Mail without tracking
            {s.mailMaxSubtotal > 0 && (
              <>; orders over {fmt(s.mailMaxSubtotal)} ship as a tracked parcel instead</>
            )}
            .
          </li>
          {media != null && (
            <li>
              <span className="font-medium">Books and media:</span> USPS Media
              Mail by weight, from {fmt(media)}.
            </li>
          )}
          {ground != null && (
            <li>
              <span className="font-medium">Everything else:</span> USPS Ground
              Advantage by weight, from {fmt(ground)}.
            </li>
          )}
        </ul>
        <p className="mt-3">
          Several items ship together in one package, priced on the combined
          weight, so the second item costs much less than the first.
          {s.freeAt > 0 && <> Orders of {fmt(s.freeAt)} or more ship free.</>}
        </p>
      </FiaSection>

      <FiaSection heading="When it ships">
        <p>
          Orders usually ship the next business day, and always within{" "}
          {BUSINESS.handlingDays.max} business days.
        </p>
      </FiaSection>

      <FiaSection heading="Delivery time">
        <p>
          Most packages arrive 2&ndash;5 business days after they ship. Media
          Mail can take up to 8.
        </p>
      </FiaSection>

      <FiaSection heading="Where we ship">
        <p>
          United States addresses only. Pieces heavier than about {maxLb} lb or
          longer than {s.maxItemSideIn}&Prime; on a side can&rsquo;t be bought
          here &mdash; their item page links to our eBay listing instead, where
          shipping is calculated for your address.
        </p>
      </FiaSection>

      <FiaSection heading="Something went wrong?">
        <p>
          If a package hasn&rsquo;t arrived or showed up damaged, email{" "}
          <a href={`mailto:${FIA_EMAIL}`} className={fiaLink}>
            {FIA_EMAIL}
          </a>{" "}
          or text {BUSINESS.phone}, and see our{" "}
          <Link href="/returns" className={fiaLink}>
            returns policy
          </Link>
          .
        </p>
      </FiaSection>
    </FiaPolicyPage>
  );
}
