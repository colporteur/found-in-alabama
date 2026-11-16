// Privacy policy for theephemeralstate.com. Replaces the old footer link
// to foundinalabama.com/privacy, which described marketplace-only sales and
// said payment details never reached us — no longer accurate once TES took
// orders directly through Stripe.

import type { Metadata } from "next";
import TesPolicyPage, { TesSection, tesLink } from "@/components/tes/TesPolicyPage";
import { BUSINESS, TES_EMAIL } from "@/lib/business";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "What The Ephemeral State collects when you browse or buy, how it's used, and how to reach us about your information.",
  alternates: { canonical: "/privacy" },
};

const LAST_UPDATED = "November 16, 2026";

const SERVICES: Array<[string, string, string]> = [
  ["Stripe", "https://stripe.com/privacy", "processes payments; card details go to Stripe, never to us"],
  ["Vercel", "https://vercel.com/legal/privacy-policy", "hosts the site and its server logs, plus cookie-free page-view counts"],
  ["Neon", "https://neon.tech/privacy-policy", "the database that stores orders"],
  ["Resend", "https://resend.com/legal/privacy-policy", "sends order and shipping emails"],
  ["Pirate Ship", "https://www.pirateship.com/privacy", "buys postage; receives the shipping address for your label"],
];

export default function TesPrivacyPage() {
  return (
    <TesPolicyPage
      title="Privacy"
      intro={<>Last updated {LAST_UPDATED}. The short version: we collect what we need to ship your order, and we don&rsquo;t sell it.</>}
    >
      <TesSection heading="Who we are">
        <p>
          The Ephemeral State (theephemeralstate.com) is a small shop run by{" "}
          {BUSINESS.owner} in {BUSINESS.shipsFrom}, part of the Found in
          Alabama family of businesses.
        </p>
      </TesSection>

      <TesSection heading="When you buy">
        <p>
          Checkout runs on Stripe. You give Stripe your name, email, shipping
          address, and payment details. We receive your name, email, shipping
          address, and what you bought &mdash; never your full card number. We
          use them to fill and ship your order, send order and shipping
          emails, handle returns, and keep the records a business is required
          to keep.
        </p>
      </TesSection>

      <TesSection heading="When you browse">
        <p>
          Our host keeps standard server logs (IP address, browser, pages
          requested, time) to run the site and stop abuse. We count page views
          with Vercel Web Analytics, which doesn&rsquo;t use cookies. Your cart
          is saved in your own browser. If you arrive with a discount code, we
          set one cookie to remember it for 30 days. We don&rsquo;t use
          advertising trackers.
        </p>
      </TesSection>

      <TesSection heading="When you contact us">
        <p>
          If you email, text, or call, we keep that conversation so we can
          answer you. We don&rsquo;t add you to a mailing list unless you ask
          to be added.
        </p>
      </TesSection>

      <TesSection heading="Services we use">
        <ul className="list-disc ml-5 space-y-1.5">
          {SERVICES.map(([name, href, what]) => (
            <li key={name}>
              <a href={href} target="_blank" rel="noopener noreferrer" className={tesLink}>
                {name}
              </a>{" "}
              &mdash; {what}.
            </li>
          ))}
        </ul>
        <p className="mt-3">
          We don&rsquo;t sell or rent your information to anyone.
        </p>
      </TesSection>

      <TesSection heading="Your choices">
        <p>
          You can ask what we have about you, ask us to correct it, or ask us
          to delete it (we&rsquo;ll keep only what tax and accounting rules
          require). Email{" "}
          <a href={`mailto:${TES_EMAIL}`} className={tesLink}>
            {TES_EMAIL}
          </a>{" "}
          or text {BUSINESS.phone}.
        </p>
      </TesSection>
    </TesPolicyPage>
  );
}
