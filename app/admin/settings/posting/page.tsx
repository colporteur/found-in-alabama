// Admin settings page: shows which posting adapters are configured and
// which channels each one handles. As we add Pinterest (2D-3b) and Publer
// (2D-3c), they'll appear here with their own setup instructions.

import Link from "next/link";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { listAdapters, channelCoverage } from "@/lib/posting";
import {
  CHANNEL_ORDER,
  CHANNELS,
  type ChannelKey,
} from "@/lib/social/channel-styles";
import { isEbayStoreConfigured } from "@/lib/ebay/store-url";
import {
  getOAuthStatus as getPinterestStatus,
  isConfigured as isPinterestConfigured,
} from "@/lib/pinterest/oauth";
import { listCachedBoards } from "@/lib/pinterest/api";
import PinterestConnectionCard from "@/components/PinterestConnectionCard";
import {
  isConfigured as isPublerConfigured,
  listCachedAccounts as listCachedPublerAccounts,
} from "@/lib/publer/api";
import PublerConnectionCard from "@/components/PublerConnectionCard";

export const dynamic = "force-dynamic";

export default async function PostingSettingsPage({
  searchParams,
}: {
  searchParams: { pinterest?: string; msg?: string };
}) {
  const session = await auth();
  if (!session?.user) redirect("/api/auth/signin");

  const adapters = listAdapters();
  const coverage = channelCoverage();
  const channels = CHANNEL_ORDER;

  // Pinterest details — needed by PinterestConnectionCard
  const pinterestConfigured = isPinterestConfigured();
  const pinterestStatus = pinterestConfigured
    ? await getPinterestStatus()
    : { connected: false };
  const pinterestBoardRows = pinterestStatus.connected
    ? await listCachedBoards()
    : [];
  const pinterestBoards = pinterestBoardRows.map((b) => ({
    boardId: b.boardId,
    name: b.name,
    privacy: b.privacy ?? null,
    pinCount: b.pinCount ?? null,
    isDefault: b.isDefault,
  }));

  // Publer details
  const publerConfigured = isPublerConfigured();
  const publerAccountRows = publerConfigured
    ? await listCachedPublerAccounts()
    : [];
  const publerAccountsForCard = publerAccountRows.map((a) => ({
    accountId: a.accountId,
    name: a.name,
    provider: a.provider,
    pictureUrl: a.pictureUrl ?? null,
    mappedToChannel: a.mappedToChannel ?? null,
  }));
  // OAuth flash from the callback
  const pinterestFlash =
    searchParams.pinterest === "ok"
      ? { kind: "ok" as const, msg: searchParams.msg ?? "Connected." }
      : searchParams.pinterest === "error"
        ? {
            kind: "error" as const,
            msg: searchParams.msg ?? "Connection failed.",
          }
        : null;

  return (
    <section className="container-content py-12">
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-6">
        <div>
          <p className="text-xs uppercase tracking-wider text-brand-earth mb-2">
            Settings
          </p>
          <h1 className="font-marker text-3xl md:text-4xl">
            Posting connections
          </h1>
        </div>
        <Link
          href="/admin"
          className="text-sm text-brand-ink/60 hover:text-brand-ink"
        >
          ← Dashboard
        </Link>
      </div>

      <p className="text-brand-ink/70 mb-8 max-w-prose">
        Status of each posting adapter and which social channels it
        currently handles. Channels with no adapter still work via the
        &ldquo;Copy post&rdquo; button — you paste manually.
      </p>

      {/* Channel coverage matrix */}
      <div className="mb-12">
        <h2 className="font-marker text-xl mb-3">Channel coverage</h2>
        <div className="border border-brand-ink/15 rounded-lg bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-brand-paper border-b border-brand-ink/10">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Channel</th>
                <th className="px-4 py-2 text-left font-medium">Adapter</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {channels.map((c: ChannelKey) => {
                const adapterId = coverage[c];
                const adapter = adapters.find((a) => a.id === adapterId);
                return (
                  <tr key={c} className="border-t border-brand-ink/10 first:border-t-0">
                    <td className="px-4 py-2.5">{CHANNELS[c].label}</td>
                    <td className="px-4 py-2.5">
                      {adapter ? (
                        <span className="font-medium">{adapter.label}</span>
                      ) : (
                        <span className="text-brand-ink/50 italic">
                          Manual copy/paste
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {!adapter ? (
                        <span className="text-xs text-brand-ink/50">—</span>
                      ) : adapter.ready ? (
                        <span className="text-xs px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-medium">
                          Ready
                        </span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-900 font-medium">
                          Needs setup
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Product-page integrations (not auto-posting, but related env config) */}
      <div className="mb-12">
        <h2 className="font-marker text-xl mb-3">Product page integrations</h2>
        <div className="border border-brand-ink/15 rounded-lg p-5 bg-white">
          <div className="flex items-baseline justify-between mb-2 gap-3">
            <h3 className="font-marker text-lg">eBay store category links</h3>
            {isEbayStoreConfigured() ? (
              <span className="text-xs px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-medium">
                Configured
              </span>
            ) : (
              <span className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-900 font-medium">
                Not configured
              </span>
            )}
          </div>
          <p className="text-sm text-brand-ink/70 mb-3">
            Drives the &ldquo;See similar items&rdquo; link on each product page.
            Without this, that link is hidden.
          </p>
          {!isEbayStoreConfigured() && (
            <details className="text-sm">
              <summary className="cursor-pointer text-brand-ink/70 hover:text-brand-ink">
                Setup instructions
              </summary>
              <ol className="mt-3 space-y-2 list-decimal list-inside text-brand-ink/85">
                <li>
                  Find your eBay seller username (visible at{" "}
                  <code className="bg-brand-paper px-1 rounded">
                    ebay.com/usr/&lt;username&gt;
                  </code>
                  ).
                </li>
                <li>
                  Add to <code className="bg-brand-paper px-1 rounded">.env.local</code> and Vercel env vars:
                  <pre className="bg-brand-paper text-brand-ink p-2 rounded mt-1 text-xs overflow-x-auto">{`EBAY_STORE_USERNAME="colporteurbooks"`}</pre>
                </li>
                <li>Redeploy. Refresh — &ldquo;See similar items&rdquo; appears on product pages.</li>
              </ol>
            </details>
          )}
        </div>
      </div>

      {/* OAuth callback flash */}
      {pinterestFlash && (
        <div
          className={`mb-6 rounded-md p-4 text-sm ${
            pinterestFlash.kind === "error"
              ? "bg-red-50 border border-red-200 text-red-900"
              : "bg-emerald-50 border border-emerald-200 text-emerald-900"
          }`}
        >
          <span className="font-medium">Pinterest:</span> {pinterestFlash.msg}
        </div>
      )}

      {/* Per-adapter detail cards */}
      <h2 className="font-marker text-xl mb-3">Adapters</h2>
      <div className="grid gap-4 md:grid-cols-2">
        {adapters.filter((a) => a.id !== "pinterest" && a.id !== "publer").map((a) => (
          <div
            key={a.id}
            className="border border-brand-ink/15 rounded-lg p-5 bg-white"
          >
            <div className="flex items-baseline justify-between mb-3 gap-3">
              <h3 className="font-marker text-lg">{a.label}</h3>
              {a.ready ? (
                <span className="text-xs px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-medium">
                  Ready
                </span>
              ) : (
                <span className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-900 font-medium">
                  Needs setup
                </span>
              )}
            </div>
            <p className="text-xs uppercase tracking-wider text-brand-ink/50 mb-2">
              Handles
            </p>
            <p className="text-sm text-brand-ink/80 mb-4">
              {a.handles.map((c) => CHANNELS[c].label).join(", ")}
            </p>
            {a.issue && (
              <div className="bg-amber-50 border border-amber-200 rounded p-3 text-sm text-amber-900">
                {a.issue}
              </div>
            )}
            {a.id === "bluesky" && (
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer text-brand-ink/70 hover:text-brand-ink">
                  Setup instructions
                </summary>
                <ol className="mt-3 space-y-2 list-decimal list-inside text-brand-ink/85">
                  <li>
                    Go to{" "}
                    <a
                      href="https://bsky.app/settings/app-passwords"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline decoration-brand-yellow decoration-2 underline-offset-2"
                    >
                      bsky.app/settings/app-passwords
                    </a>{" "}
                    and create a new app password (don&rsquo;t reuse your real
                    login password).
                  </li>
                  <li>
                    Add these to <code className="bg-brand-paper px-1 rounded">.env.local</code> and to
                    Vercel project settings:
                    <pre className="bg-brand-paper text-brand-ink p-2 rounded mt-1 text-xs overflow-x-auto">{`BLUESKY_HANDLE="foundinalabama.bsky.social"\nBLUESKY_APP_PASSWORD="xxxx-xxxx-xxxx-xxxx"`}</pre>
                  </li>
                  <li>
                    Redeploy (Vercel restarts on env-var changes
                    automatically).
                  </li>
                  <li>Refresh this page — the status should flip to Ready.</li>
                </ol>
              </details>
            )}
          </div>
        ))}

        {/* Pinterest gets its own card with OAuth + boards */}
        <PinterestConnectionCard
          configured={pinterestConfigured}
          connected={pinterestStatus.connected}
          username={pinterestStatus.pinterestUsername ?? null}
          accessExpiresAt={
            pinterestStatus.accessTokenExpiresAt?.toISOString() ?? null
          }
          refreshExpiresAt={
            pinterestStatus.refreshTokenExpiresAt?.toISOString() ?? null
          }
          initialBoards={pinterestBoards}
          oauthIssue={
            !pinterestConfigured
              ? "Set PINTEREST_CLIENT_ID, PINTEREST_CLIENT_SECRET, PINTEREST_REDIRECT_URI, and PINTEREST_OAUTH_STATE_SECRET in Vercel."
              : null
          }
        />

        {/* Publer — wide card with mapping table */}
        <PublerConnectionCard
          configured={publerConfigured}
          initialAccounts={publerAccountsForCard}
          oauthIssue={
            !publerConfigured
              ? "Set PUBLER_API_KEY and PUBLER_WORKSPACE_ID in Vercel env vars."
              : null
          }
        />
      </div>
    </section>
  );
}

function ComingSoon({
  label,
  phase,
  handles,
}: {
  label: string;
  phase: string;
  handles: string;
}) {
  return (
    <div className="border border-dashed border-brand-ink/20 rounded-lg p-5 bg-brand-paper/50">
      <div className="flex items-baseline justify-between mb-3 gap-3">
        <h3 className="font-marker text-lg text-brand-ink/70">{label}</h3>
        <span className="text-xs px-2 py-0.5 rounded bg-brand-ink/10 text-brand-ink/60 font-medium">
          Phase {phase}
        </span>
      </div>
      <p className="text-xs uppercase tracking-wider text-brand-ink/50 mb-2">
        Will handle
      </p>
      <p className="text-sm text-brand-ink/70">{handles}</p>
    </div>
  );
}
