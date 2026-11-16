// About — who's behind the shop. Merchant Center's Misrepresentation review
// wants the seller's identity to be clear on the store's own domain.

import type { Metadata } from "next";
import Link from "next/link";
import TesPolicyPage, { TesSection, tesLink } from "@/components/tes/TesPolicyPage";
import { BUSINESS } from "@/lib/business";

export const metadata: Metadata = {
  title: "About",
  description: `The Ephemeral State is a small, owner-run ephemera shop in ${BUSINESS.shipsFrom} — postcards, photographs, and paper Americana from every state, sold and shipped directly by us.`,
  alternates: { canonical: "/about" },
};

// NOTE FOR TODD: starter copy — rewrite anything that doesn't sound like you.

export default function TesAboutPage() {
  return (
    <TesPolicyPage
      title="About The Ephemeral State"
      intro="Antique paper Americana, state by state."
    >
      <TesSection heading="Who we are">
        <p>
          The Ephemeral State is a small, owner-run shop based in{" "}
          {BUSINESS.shipsFrom}. It&rsquo;s run by {BUSINESS.owner}, who also
          runs{" "}
          <a
            href="https://www.foundinalabama.com"
            target="_blank"
            rel="noopener noreferrer"
            className={tesLink}
          >
            Found in Alabama
          </a>
          , the estate and collectibles business this shop grew out of.
        </p>
      </TesSection>

      <TesSection heading="What we sell">
        <p>
          Postcards, photographs, letters, documents, trade cards, menus,
          programs, and the other paper that people meant to throw away and
          didn&rsquo;t. Each piece is photographed and described as honestly
          as we can, flaws included.
        </p>
      </TesSection>

      <TesSection heading="How buying works">
        <p>
          When you buy here, you buy from us. Checkout is handled securely by
          Stripe, and we pack and ship every order ourselves. Many pieces are
          also listed on our eBay store; prices on this site are lower because
          we don&rsquo;t pay marketplace fees here.
        </p>
      </TesSection>

      <TesSection heading="Questions?">
        <p>
          <Link href="/contact" className={tesLink}>
            Get in touch
          </Link>
          {" "}&mdash; or read about{" "}
          <Link href="/shipping" className={tesLink}>
            shipping
          </Link>{" "}
          and{" "}
          <Link href="/returns" className={tesLink}>
            returns
          </Link>
          . If you have a collection to sell,{" "}
          <Link href="/we-buy" className={tesLink}>
            we buy ephemera
          </Link>
          .
        </p>
      </TesSection>
    </TesPolicyPage>
  );
}
