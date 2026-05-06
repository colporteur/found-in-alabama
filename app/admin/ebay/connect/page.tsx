// Connection settings + Test connection page. The actual creds live in
// .env.local; this page just lets Todd verify the Trading API responds.

import Link from "next/link";
import TestConnectionButton from "./TestConnectionButton";

export const dynamic = "force-dynamic";

export default function EbayConnectPage() {
  const status = {
    appId: !!process.env.EBAY_APP_ID,
    devId: !!process.env.EBAY_DEV_ID,
    certId: !!process.env.EBAY_CERT_ID,
    authToken: !!process.env.EBAY_AUTH_TOKEN,
    env: process.env.EBAY_ENV ?? "production",
    siteId: process.env.EBAY_SITE_ID ?? "0",
  };
  const allSet = status.appId && status.devId && status.certId && status.authToken;

  return (
    <section className="container-content py-12">
      <p className="text-xs uppercase tracking-wider text-brand-earth mb-2">
        eBay tools
      </p>
      <h1 className="font-marker text-3xl md:text-4xl mb-3">
        Connection settings
      </h1>
      <p className="text-brand-ink/70 mb-8 max-w-prose">
        Credentials are read from <code>.env.local</code>. To rotate the
        token, edit that file and restart the dev server. Setup steps live
        in <code>PHASE-EBAY-1-SETUP.md</code>.
      </p>

      <div className="bg-white border border-brand-ink/15 rounded-lg p-5 mb-6">
        <h2 className="font-medium text-lg mb-3">Environment</h2>
        <ul className="text-sm space-y-1.5">
          <EnvLine label="EBAY_APP_ID" set={status.appId} />
          <EnvLine label="EBAY_DEV_ID" set={status.devId} />
          <EnvLine label="EBAY_CERT_ID" set={status.certId} />
          <EnvLine label="EBAY_AUTH_TOKEN" set={status.authToken} />
          <li className="flex justify-between border-t border-brand-ink/10 pt-1.5 mt-1.5">
            <code className="text-brand-ink/70">EBAY_ENV</code>
            <span className="text-brand-ink/80">{status.env}</span>
          </li>
          <li className="flex justify-between">
            <code className="text-brand-ink/70">EBAY_SITE_ID</code>
            <span className="text-brand-ink/80">{status.siteId}</span>
          </li>
        </ul>
      </div>

      {allSet ? (
        <TestConnectionButton />
      ) : (
        <div className="bg-white border border-dashed border-brand-ink/30 rounded-lg p-5">
          <p className="font-medium mb-1">
            Add the missing env vars and restart the dev server to enable the
            connection test.
          </p>
          <p className="text-sm text-brand-ink/70">
            See <code>PHASE-EBAY-1-SETUP.md</code> for step-by-step.
          </p>
        </div>
      )}

      <div className="mt-10">
        <Link
          href="/admin/ebay"
          className="text-sm text-brand-ink/60 hover:text-brand-ink"
        >
          ← Back to eBay tools
        </Link>
      </div>
    </section>
  );
}

function EnvLine({ label, set }: { label: string; set: boolean }) {
  return (
    <li className="flex justify-between">
      <code className="text-brand-ink/70">{label}</code>
      <span
        className={
          set
            ? "text-xs uppercase tracking-wider px-2 py-0.5 rounded bg-brand-yellow/30 text-brand-ink"
            : "text-xs uppercase tracking-wider px-2 py-0.5 rounded bg-brand-ink/10 text-brand-ink/60"
        }
      >
        {set ? "Set" : "Missing"}
      </span>
    </li>
  );
}
