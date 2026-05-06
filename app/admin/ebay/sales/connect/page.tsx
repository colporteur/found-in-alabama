// OAuth connection management for the Sell APIs. Shows connection status,
// the Connect button (which kicks off /api/admin/ebay/oauth/start), and a
// Test connection button that calls a Sell API endpoint to verify the
// access token works.

import Link from "next/link";
import { getOAuthStatus } from "@/lib/ebay/oauth";
import OAuthControls from "./OAuthControls";

export const dynamic = "force-dynamic";

export default async function ConnectOAuthPage({
  searchParams,
}: {
  searchParams: { oauth?: string; oauth_error?: string };
}) {
  const status = await getOAuthStatus();

  const envVarsSet =
    !!process.env.EBAY_RU_NAME &&
    !!process.env.EBAY_OAUTH_REDIRECT_URI &&
    !!process.env.EBAY_OAUTH_STATE_SECRET;

  return (
    <section className="container-content py-12">
      <p className="text-xs uppercase tracking-wider text-brand-earth mb-2">
        eBay tools · Sales · Connect
      </p>
      <h1 className="font-marker text-3xl md:text-4xl mb-3">
        Connect Sell APIs
      </h1>
      <p className="text-brand-ink/70 mb-8 max-w-prose">
        Sales and promotions live in eBay&rsquo;s newer Sell APIs, which
        require an OAuth-issued access token (different from the
        Auth&rsquo;n&rsquo;Auth user token used elsewhere in this tool).
        Click Connect to authorize this app on your seller account once,
        then we keep the access token fresh in the background.
      </p>

      {searchParams.oauth === "ok" && (
        <div className="border-l-4 border-brand-yellow bg-brand-yellow/10 p-4 text-sm rounded mb-6">
          ✅ Connected. Tokens stored. You can now move on to creating sales.
        </div>
      )}
      {searchParams.oauth_error && (
        <div className="border-l-4 border-red-500 bg-red-50 p-4 text-sm rounded mb-6 break-words">
          ❌ OAuth failed: {searchParams.oauth_error}
        </div>
      )}

      <div className="bg-white border border-brand-ink/15 rounded-lg p-5 mb-6">
        <h2 className="font-medium text-lg mb-3">Environment</h2>
        <ul className="text-sm space-y-1.5">
          <EnvLine name="EBAY_RU_NAME" set={!!process.env.EBAY_RU_NAME} />
          <EnvLine
            name="EBAY_OAUTH_REDIRECT_URI"
            set={!!process.env.EBAY_OAUTH_REDIRECT_URI}
          />
          <EnvLine
            name="EBAY_OAUTH_STATE_SECRET"
            set={!!process.env.EBAY_OAUTH_STATE_SECRET}
          />
        </ul>
        {!envVarsSet && (
          <p className="text-xs text-brand-ink/60 mt-3">
            Add the missing env vars in Vercel and redeploy. Setup steps
            are in <code>PHASE-EBAY-2-SETUP.md</code>.
          </p>
        )}
      </div>

      <div className="bg-white border border-brand-ink/15 rounded-lg p-5 mb-6">
        <h2 className="font-medium text-lg mb-3">Connection status</h2>
        {status.connected ? (
          <div className="space-y-2 text-sm">
            <p>
              <span className="text-xs uppercase tracking-wider px-2 py-1 rounded bg-brand-yellow/30 text-brand-ink mr-2">
                Connected
              </span>
              <span className="text-brand-ink/70">
                Refresh token valid until{" "}
                {status.refreshTokenExpiresAt?.toLocaleDateString()}
              </span>
            </p>
            <p className="text-xs text-brand-ink/60">
              Access token refreshes automatically every ~2 hours. The
              refresh token itself lasts ~18 months — you&rsquo;ll need to
              reconnect once before it expires.
            </p>
          </div>
        ) : (
          <p className="text-sm text-brand-ink/70">
            Not connected. Click Connect below to start the OAuth flow.
          </p>
        )}
      </div>

      <OAuthControls
        envVarsSet={envVarsSet}
        connected={status.connected}
      />

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

function EnvLine({ name, set }: { name: string; set: boolean }) {
  return (
    <li className="flex justify-between">
      <code className="text-brand-ink/70">{name}</code>
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
