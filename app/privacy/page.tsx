import type { Metadata } from "next";
import Link from "next/link";
import { contact } from "@/lib/links";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "What information Found in Alabama collects, how we use it, and how to contact us about your data.",
};

const LAST_UPDATED = "June 9, 2026";
const CONTACT_EMAIL = "hello@foundinalabama.com";

export default function PrivacyPage() {
  return (
    <article className="container-content py-12">
      <Link
        href="/"
        className="text-sm text-brand-ink/60 hover:text-brand-ink"
      >
        ← Home
      </Link>

      <header className="mt-6 mb-8">
        <p className="text-xs uppercase tracking-wider text-brand-earth mb-3">
          Privacy policy
        </p>
        <h1 className="font-marker text-4xl md:text-5xl leading-tight mb-3">
          How we handle your information.
        </h1>
        <p className="text-sm text-brand-ink/60">Last updated {LAST_UPDATED}</p>
      </header>

      <div className="prose-fia max-w-prose space-y-5 leading-relaxed">
        <section className="bg-brand-paper border border-brand-ink/10 rounded-lg p-5 mb-8">
          <p className="text-xs uppercase tracking-wider text-brand-earth mb-2">
            The short version
          </p>
          <p>
            We don&rsquo;t sell your data. We collect very little — basically
            standard server logs and whatever you choose to send us by text or
            email. Sales themselves happen on third-party marketplaces (eBay,
            Etsy, Poshmark, Mercari, Depop, Whatnot) — those companies handle
            customer information for the transaction; we never see your payment
            details. We post about our inventory on social media (Pinterest,
            BlueSky, Facebook, Instagram, X) and use a scheduling service to do
            so; we use those platforms&rsquo; APIs only to publish to our own
            accounts and do not access or store other users&rsquo; data.
          </p>
        </section>

        <h2 className="font-marker text-2xl mt-10 mb-3">Who we are</h2>
        <p>
          Found in Alabama is a small reseller of estate finds, vintage, books,
          ephemera, and small antiques operating out of Alabama. This privacy
          policy applies to <code>foundinalabama.com</code> and any sub-paths
          on it. For purchases made on a third-party marketplace, that
          marketplace&rsquo;s own privacy policy governs the transaction.
        </p>

        <h2 className="font-marker text-2xl mt-10 mb-3">
          What we collect, and why
        </h2>

        <h3 className="font-medium text-lg mt-6 mb-2">
          When you visit our website
        </h3>
        <p>
          Our hosting provider records standard server logs — your IP address,
          browser type, the pages you requested, and timestamps. We use these
          to keep the site running, debug issues, and spot abuse. We do not use
          third-party advertising trackers. We do not use Google Analytics,
          Facebook Pixel, or similar marketing tools.
        </p>

        <h3 className="font-medium text-lg mt-6 mb-2">When you contact us</h3>
        <p>
          If you text or call the phone number on our site ({contact.phone}),
          your number is in our phone records. If you email us, your email
          address is in our inbox. We use these to respond to you about
          estates, sales, returns, or other questions. We don&rsquo;t add you
          to any marketing list — we don&rsquo;t have one.
        </p>

        <h3 className="font-medium text-lg mt-6 mb-2">
          When you buy from us on a marketplace
        </h3>
        <p>
          The marketplace (eBay, Etsy, Poshmark, Mercari, Depop, or Whatnot)
          handles your order and shares your shipping address with us so we can
          ship to you. We see only what the marketplace shares. Payment details
          never come to us — the marketplace handles them.
        </p>

        <h3 className="font-medium text-lg mt-6 mb-2">Cookies</h3>
        <p>
          We use one functional cookie when an administrator (currently the
          owner) signs in to manage the site. We do not use tracking,
          analytics, or advertising cookies.
        </p>

        <h2 className="font-marker text-2xl mt-10 mb-3">
          Third-party services we use
        </h2>
        <p>
          We use a small number of services to run the site and the business.
          Each has its own privacy policy linked below.
        </p>
        <ul className="list-disc list-outside ml-5 space-y-1.5 mt-2">
          <li>
            <a
              href="https://vercel.com/legal/privacy-policy"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-brand-yellow decoration-2 underline-offset-2"
            >
              Vercel
            </a>{" "}
            — website hosting and server logs.
          </li>
          <li>
            <a
              href="https://neon.tech/privacy-policy"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-brand-yellow decoration-2 underline-offset-2"
            >
              Neon
            </a>{" "}
            — database for our inventory and saved drafts. Customer data is
            not stored here.
          </li>
          <li>
            <a
              href="https://resend.com/legal/privacy-policy"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-brand-yellow decoration-2 underline-offset-2"
            >
              Resend
            </a>{" "}
            — sends magic-link sign-in emails to the owner.
          </li>
          <li>
            <a
              href="https://github.com/site/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-brand-yellow decoration-2 underline-offset-2"
            >
              GitHub
            </a>{" "}
            — stores our published journal posts and source code.
          </li>
          <li>
            <a
              href="https://www.anthropic.com/legal/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-brand-yellow decoration-2 underline-offset-2"
            >
              Anthropic
            </a>{" "}
            — generates draft narrative copy from photos and notes the owner
            provides. We do not send customer data to Anthropic.
          </li>
          <li>
            The marketplaces we sell on:{" "}
            <a
              href="https://www.ebay.com/help/policies/member-behavior-policies/user-privacy-notice-privacy-policy"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-brand-yellow decoration-2 underline-offset-2"
            >
              eBay
            </a>
            ,{" "}
            <a
              href="https://www.etsy.com/legal/privacy/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-brand-yellow decoration-2 underline-offset-2"
            >
              Etsy
            </a>
            ,{" "}
            <a
              href="https://poshmark.com/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-brand-yellow decoration-2 underline-offset-2"
            >
              Poshmark
            </a>
            ,{" "}
            <a
              href="https://www.mercari.com/privacy/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-brand-yellow decoration-2 underline-offset-2"
            >
              Mercari
            </a>
            ,{" "}
            <a
              href="https://www.depop.com/privacy/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-brand-yellow decoration-2 underline-offset-2"
            >
              Depop
            </a>
            , and{" "}
            <a
              href="https://www.whatnot.com/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-brand-yellow decoration-2 underline-offset-2"
            >
              Whatnot
            </a>
            .
          </li>
          <li>
            The social platforms where we post:{" "}
            <a
              href="https://policy.pinterest.com/en/privacy-policy"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-brand-yellow decoration-2 underline-offset-2"
            >
              Pinterest
            </a>
            ,{" "}
            <a
              href="https://bsky.social/about/support/privacy-policy"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-brand-yellow decoration-2 underline-offset-2"
            >
              BlueSky
            </a>
            ,{" "}
            <a
              href="https://www.facebook.com/privacy/policy"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-brand-yellow decoration-2 underline-offset-2"
            >
              Facebook
            </a>
            ,{" "}
            <a
              href="https://privacycenter.instagram.com/policy"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-brand-yellow decoration-2 underline-offset-2"
            >
              Instagram
            </a>
            , and{" "}
            <a
              href="https://x.com/en/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-brand-yellow decoration-2 underline-offset-2"
            >
              X
            </a>
            .
          </li>
          <li>
            <a
              href="https://publer.com/privacy-policy"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-brand-yellow decoration-2 underline-offset-2"
            >
              Publer
            </a>{" "}
            — schedules our outgoing posts to Instagram, Facebook, and X.
          </li>
        </ul>

        <h2 className="font-marker text-2xl mt-10 mb-3">
          How we use social platform APIs
        </h2>
        <p>
          When we connect Found in Alabama to Pinterest, BlueSky, Facebook,
          Instagram, X, or Publer, we use OAuth or API keys to publish content{" "}
          <em>to our own accounts</em>. The permissions we request are limited
          to posting on our behalf, reading our own boards or pages for
          posting purposes, and basic account identification (so we can show
          which of our accounts is connected). We do not access, read, or
          store other users&rsquo; data from those platforms. If a platform
          requires us to retain copies of data (for example a post id so we
          can deduplicate or remove a post later), we keep only what&rsquo;s
          necessary for that function.
        </p>

        <h2 className="font-marker text-2xl mt-10 mb-3">Your rights</h2>
        <p>
          If you&rsquo;ve contacted us by text or email and want us to delete
          your message, email us at{" "}
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="underline decoration-brand-yellow decoration-2 underline-offset-2"
          >
            {CONTACT_EMAIL}
          </a>{" "}
          and we will.
        </p>
        <p>
          If you bought from us via a marketplace, your account and order are
          managed by the marketplace itself — contact them for changes to your
          account or order. If we kept any private notes about your transaction
          on our side and you want them removed, email us and we&rsquo;ll
          remove them.
        </p>
        <p>
          California, EU, and UK residents have additional statutory rights
          under the CCPA, GDPR, and UK GDPR (including the right to access,
          correct, and delete personal information we hold about you). To
          exercise any of these, email us at{" "}
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="underline decoration-brand-yellow decoration-2 underline-offset-2"
          >
            {CONTACT_EMAIL}
          </a>
          .
        </p>

        <h2 className="font-marker text-2xl mt-10 mb-3">Children</h2>
        <p>
          The site isn&rsquo;t directed at children under 13, and we do not
          knowingly collect information from them.
        </p>

        <h2 className="font-marker text-2xl mt-10 mb-3">
          Changes to this policy
        </h2>
        <p>
          We may update this policy as the business evolves or as the services
          we use change. The &ldquo;Last updated&rdquo; date at the top will
          change when we do. Material changes will be summarized at the top of
          the policy for a reasonable time after they go into effect.
        </p>

        <h2 className="font-marker text-2xl mt-10 mb-3">Contact</h2>
        <p>
          Questions about this policy, or about how we handle your information:
        </p>
        <ul className="list-disc list-outside ml-5 space-y-1 mt-2">
          <li>
            Email:{" "}
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="underline decoration-brand-yellow decoration-2 underline-offset-2"
            >
              {CONTACT_EMAIL}
            </a>
          </li>
          <li>
            Text:{" "}
            <a
              href={contact.smsHref}
              className="underline decoration-brand-yellow decoration-2 underline-offset-2"
            >
              {contact.phone}
            </a>
          </li>
        </ul>
      </div>

      <div className="mt-16 pt-8 border-t border-brand-ink/10">
        <Link
          href="/"
          className="text-sm text-brand-ink/60 hover:text-brand-ink"
        >
          ← Back home
        </Link>
      </div>
    </article>
  );
}
