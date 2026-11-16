// Shipping policy — rates come straight from SHIP_SCHEDULE, the same table
// the cart and checkout use, so this page can't drift from what buyers pay.
// Merchant Center wants shipping cost, handling time and where you ship.

import type { Metadata } from "next";
import Link from "next/link";
import TesPolicyPage, { TesSection, tesLink } from "@/components/tes/TesPolicyPage";
import { SHIP_SCHEDULE, type ShipClass } from "@/lib/tes/shipping";
import { BUSINESS, TES_EMAIL } from "@/lib/business";

export const metadata: Metadata = {
  title: "Shipping",
  description:
    "Shipping for The Ephemeral State: flat rates by item type from $1.99, combined shipping on multiple pieces, free shipping over set order totals. US addresses only.",
  alternates: { canonical: "/shipping" },
};

const fmt = (n: number) => `$${n.toFixed(2)}`;

const WHAT: Record<ShipClass, string> = {
  paper: "Postcards, photographs, trade cards, and other small paper",
  flat: "Larger flat paper — documents, prints, menus, magazine pages",
  media: "Books, booklets, and magazines",
  bulky: "Albums, framed pieces, and other heavier items",
};

export default function TesShippingPage() {
  const classes = Object.keys(SHIP_SCHEDULE) as ShipClass[];
  return (
    <TesPolicyPage
      title="Shipping"
      intro={
        <>
          Every order is packed by hand and shipped by USPS from{" "}
          {BUSINESS.shipsFrom}. Paper goes out flat and protected with a
          stiffener.
        </>
      }
    >
      <TesSection heading="Rates">
        <p className="mb-4">
          Each item page shows its shipping. In a cart, you pay the first-item
          rate of the largest piece, plus a small add-on for each additional
          piece.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left border-b border-tes-ink/20">
                <th className="py-2 pr-4 font-medium">Type</th>
                <th className="py-2 pr-4 font-medium">First item</th>
                <th className="py-2 pr-4 font-medium">Each additional</th>
                <th className="py-2 font-medium">Free at</th>
              </tr>
            </thead>
            <tbody>
              {classes.map((c) => {
                const s = SHIP_SCHEDULE[c];
                return (
                  <tr key={c} className="border-b border-tes-ink/10 align-top">
                    <td className="py-2 pr-4">
                      <span className="font-medium">{s.label}</span>
                      <br />
                      <span className="text-tes-ink/60">{WHAT[c]}</span>
                    </td>
                    <td className="py-2 pr-4">{fmt(s.first)}</td>
                    <td className="py-2 pr-4">+{fmt(s.additional)}</td>
                    <td className="py-2">{fmt(s.freeAt)}+</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-sm text-tes-ink/70">
          The &ldquo;free at&rdquo; amount is your merchandise subtotal and
          goes by the largest type in your cart.
        </p>
      </TesSection>

      <TesSection heading="When it ships">
        <p>
          Orders usually ship the next business day, and always within{" "}
          {BUSINESS.handlingDays.max} business days.
        </p>
      </TesSection>

      <TesSection heading="Delivery time">
        <p>
          Most packages arrive 2&ndash;5 business days after they ship; books
          sent Media Mail can take up to 8.
          Postcards and small paper usually go First-Class Mail in a stamped
          envelope, which has no tracking. Books and heavier pieces ship with
          tracking.
        </p>
      </TesSection>

      <TesSection heading="Where we ship">
        <p>
          United States addresses only. We don&rsquo;t ship
          internationally from this site.
        </p>
      </TesSection>

      <TesSection heading="Something went wrong?">
        <p>
          If a package hasn&rsquo;t arrived or showed up damaged, email{" "}
          <a href={`mailto:${TES_EMAIL}`} className={tesLink}>
            {TES_EMAIL}
          </a>{" "}
          and we&rsquo;ll make it right. See our{" "}
          <Link href="/returns" className={tesLink}>
            returns policy
          </Link>{" "}
          too.
        </p>
      </TesSection>
    </TesPolicyPage>
  );
}
