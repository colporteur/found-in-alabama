// Contact — who runs the shop and how to reach a person. Google Merchant
// Center's Misrepresentation review looks for a visible, working contact
// method on the store's own domain.

import type { Metadata } from "next";
import Link from "next/link";
import TesPolicyPage, { TesSection, tesLink } from "@/components/tes/TesPolicyPage";
import { BUSINESS, TES_EMAIL } from "@/lib/business";

export const metadata: Metadata = {
  title: "Contact",
  description: `Reach The Ephemeral State: email ${TES_EMAIL} or text/call ${BUSINESS.phone}. Questions about an item, an order, or a return.`,
  alternates: { canonical: "/contact" },
};

export default function TesContactPage() {
  return (
    <TesPolicyPage
      title="Contact us"
      intro={
        <>
          The Ephemeral State is run by {BUSINESS.owner}, out of{" "}
          {BUSINESS.shipsFrom}. A real person answers every message.
        </>
      }
    >
      <TesSection heading="Email">
        <p>
          <a href={`mailto:${TES_EMAIL}`} className={tesLink}>
            {TES_EMAIL}
          </a>
          <br />
          Best for order questions, returns, and anything with photos.
        </p>
      </TesSection>

      <TesSection heading="Text or call">
        <p>
          <a href={`sms:${BUSINESS.phoneE164}`} className={tesLink}>
            {BUSINESS.phone}
          </a>{" "}
          (text preferred). If you call and we miss you, leave a voicemail.
        </p>
      </TesSection>

      <TesSection heading="When to expect a reply">
        <p>
          Usually the same day, and always within one business day. If
          you&rsquo;re writing about an order, include your order number from
          the confirmation email.
        </p>
      </TesSection>

      <TesSection heading="Orders and returns">
        <p>
          Every purchase on this site is processed securely by Stripe and
          shipped by us from {BUSINESS.shipsFrom}. See{" "}
          <Link href="/shipping" className={tesLink}>
            shipping
          </Link>{" "}
          and{" "}
          <Link href="/returns" className={tesLink}>
            returns
          </Link>{" "}
          for the details.
        </p>
      </TesSection>
    </TesPolicyPage>
  );
}
