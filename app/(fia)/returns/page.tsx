// Returns & refunds for purchases made on foundinalabama.com. Google
// Merchant Center requires a return policy on the store's own domain.
// Same terms as The Ephemeral State's /returns.

import type { Metadata } from "next";
import FiaPolicyPage, { FiaSection, fiaLink } from "@/components/fia/FiaPolicyPage";
import { BUSINESS, FIA_EMAIL } from "@/lib/business";

export const metadata: Metadata = {
  title: "Returns & refunds",
  description: `Return policy for Found in Alabama: ${BUSINESS.returnDays}-day returns on items bought on foundinalabama.com, refunded in full to your original payment method.`,
  alternates: { canonical: "/returns" },
};

export default function FiaReturnsPage() {
  return (
    <FiaPolicyPage
      eyebrow="Returns & refunds"
      title="If it isn't right, send it back."
      intro="This policy covers purchases made here on foundinalabama.com. If you bought from us on a marketplace like eBay, that marketplace's return process applies."
    >
      <FiaSection heading={`${BUSINESS.returnDays}-day returns`}>
        <p>
          You may return any item within {BUSINESS.returnDays} days of
          delivery, for any reason. Contact us first so we know it&rsquo;s
          coming, then send it back in the condition it arrived in, packed as
          carefully as we packed it.
        </p>
      </FiaSection>

      <FiaSection heading="Refunds">
        <p>
          Once the item is back with us, we refund the full purchase price to
          your original payment method, normally within 3 business days. If
          something arrives damaged or isn&rsquo;t as described, tell us right
          away &mdash; we&rsquo;ll make it right, including the return postage.
        </p>
      </FiaSection>

      <FiaSection heading="Return shipping">
        <p>
          For a change-of-mind return, the buyer pays return postage. For
          anything that was our mistake &mdash; damage in transit, an error in
          the description &mdash; we pay it.
        </p>
      </FiaSection>

      <FiaSection heading="How to start a return">
        <p>
          Email{" "}
          <a href={`mailto:${FIA_EMAIL}`} className={fiaLink}>
            {FIA_EMAIL}
          </a>{" "}
          or text{" "}
          <a href={`sms:${BUSINESS.phoneE164}`} className={fiaLink}>
            {BUSINESS.phone}
          </a>{" "}
          with your order number and we&rsquo;ll take it from there.
        </p>
      </FiaSection>
    </FiaPolicyPage>
  );
}
