"use client";

// Publer connection card on /admin/settings/posting. Shows API-key
// readiness, account list, and per-channel mapping.
//
// Test connection (GET /test) verifies the env vars work.
// Sync accounts (POST /accounts/sync) refreshes the cache.
// Mapping (POST /mapping) assigns one Publer account per ChannelKey.

import { useState } from "react";
import { CHANNELS, type ChannelKey } from "@/lib/social/channel-styles";

const PUBLER_CHANNELS: ChannelKey[] = [
  "instagram_feed",
  "instagram_story",
  "facebook",
  "twitter",
];

export type AccountOption = {
  accountId: string;
  name: string;
  provider: string;
  pictureUrl: string | null;
  mappedToChannel: string | null;
};

export default function PublerConnectionCard({
  configured,
  initialAccounts,
  oauthIssue,
}: {
  configured: boolean;
  initialAccounts: AccountOption[];
  oauthIssue: string | null;
}) {
  const [accounts, setAccounts] = useState<AccountOption[]>(initialAccounts);
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ kind: "ok" | "error"; msg: string } | null>(null);

  async function testConnection() {
    setBusy("test");
    setFlash(null);
    try {
      const res = await fetch("/api/admin/publer/test");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setFlash({
        kind: "ok",
        msg: `Connected as ${data.me?.email ?? data.me?.name ?? "Publer user"}.`,
      });
    } catch (err) {
      setFlash({
        kind: "error",
        msg: err instanceof Error ? err.message : "Test failed",
      });
    } finally {
      setBusy(null);
    }
  }

  async function syncAccounts() {
    setBusy("sync");
    setFlash(null);
    try {
      const res = await fetch("/api/admin/publer/accounts/sync", {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setFlash({
        kind: "ok",
        msg: `Synced ${data.accountCount ?? 0} account${data.accountCount === 1 ? "" : "s"}.`,
      });
      setTimeout(() => window.location.reload(), 600);
    } catch (err) {
      setFlash({
        kind: "error",
        msg: err instanceof Error ? err.message : "Sync failed",
      });
    } finally {
      setBusy(null);
    }
  }

  async function setChannel(accountId: string, channel: string | null) {
    setBusy(`map:${accountId}`);
    setFlash(null);
    try {
      const res = await fetch("/api/admin/publer/mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, channel }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      // Local update — clear any other account that had this channel,
      // then set the target.
      setAccounts((prev) =>
        prev.map((a) => {
          if (channel && a.mappedToChannel === channel && a.accountId !== accountId) {
            return { ...a, mappedToChannel: null };
          }
          if (a.accountId === accountId) {
            return { ...a, mappedToChannel: channel };
          }
          return a;
        })
      );
    } catch (err) {
      setFlash({
        kind: "error",
        msg: err instanceof Error ? err.message : "Mapping failed",
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="border border-brand-ink/15 rounded-lg p-5 bg-white md:col-span-2">
      <div className="flex items-baseline justify-between mb-3 gap-3">
        <h3 className="font-marker text-lg">Publer</h3>
        {!configured ? (
          <span className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-900 font-medium">
            Needs setup
          </span>
        ) : accounts.length === 0 ? (
          <span className="text-xs px-2 py-0.5 rounded bg-brand-ink/10 text-brand-ink/70 font-medium">
            No accounts synced
          </span>
        ) : (
          <span className="text-xs px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-medium">
            {accounts.length} account{accounts.length === 1 ? "" : "s"} cached
          </span>
        )}
      </div>
      <p className="text-xs uppercase tracking-wider text-brand-ink/50 mb-2">
        Handles
      </p>
      <p className="text-sm text-brand-ink/80 mb-4">
        Instagram (feed + stories), Facebook, X
      </p>

      {flash && (
        <div
          className={`mb-3 rounded p-3 text-sm ${
            flash.kind === "error"
              ? "bg-red-50 border border-red-200 text-red-900"
              : "bg-emerald-50 border border-emerald-200 text-emerald-900"
          }`}
        >
          {flash.msg}
        </div>
      )}

      {!configured && (
        <div className="bg-amber-50 border border-amber-200 rounded p-3 text-sm text-amber-900 mb-3">
          {oauthIssue ?? "Publer env vars missing."}
        </div>
      )}

      {configured && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <button
              onClick={testConnection}
              disabled={busy === "test"}
              className="text-sm px-3 py-1.5 border border-brand-ink/20 rounded hover:bg-brand-ink/5 transition-colors disabled:opacity-50"
            >
              {busy === "test" ? "Testing…" : "Test connection"}
            </button>
            <button
              onClick={syncAccounts}
              disabled={busy === "sync"}
              className="text-sm px-3 py-1.5 bg-brand-yellow text-brand-ink font-medium rounded hover:bg-brand-yellow-dark transition-colors disabled:opacity-50"
            >
              {busy === "sync" ? "Syncing…" : "Sync accounts"}
            </button>
          </div>

          {accounts.length === 0 ? (
            <p className="text-sm text-brand-ink/60 italic">
              No accounts cached yet. Click &ldquo;Sync accounts&rdquo;.
            </p>
          ) : (
            <div>
              <p className="text-xs uppercase tracking-wider text-brand-ink/55 font-medium mb-2">
                Channel mapping — each row sets which of our channels uses this
                Publer account
              </p>
              <div className="border border-brand-ink/10 rounded divide-y divide-brand-ink/10">
                {accounts.map((a) => (
                  <div
                    key={a.accountId}
                    className="flex items-center gap-3 px-3 py-3"
                  >
                    {a.pictureUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={a.pictureUrl}
                        alt=""
                        className="w-10 h-10 rounded-full object-cover shrink-0"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-brand-paper shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{a.name}</p>
                      <p className="text-xs text-brand-ink/55">{a.provider}</p>
                    </div>
                    <select
                      value={a.mappedToChannel ?? ""}
                      onChange={(e) =>
                        setChannel(a.accountId, e.target.value || null)
                      }
                      disabled={busy === `map:${a.accountId}`}
                      className="text-xs px-2 py-1.5 border border-brand-ink/20 rounded bg-white focus:outline-none focus:ring-2 focus:ring-brand-yellow"
                    >
                      <option value="">(unassigned)</option>
                      {PUBLER_CHANNELS.map((c) => (
                        <option key={c} value={c}>
                          {CHANNELS[c].label}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              <p className="text-xs text-brand-ink/55 mt-2">
                Each of our channels can only have one Publer account at a time;
                picking it on one row clears it on any other.
              </p>
            </div>
          )}
        </div>
      )}

      <details className="mt-4 text-sm">
        <summary className="cursor-pointer text-brand-ink/70 hover:text-brand-ink">
          Setup instructions
        </summary>
        <ol className="mt-3 space-y-2 list-decimal list-inside text-brand-ink/85">
          <li>
            Sign up at{" "}
            <a
              href="https://publer.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-brand-yellow decoration-2 underline-offset-2"
            >
              publer.com
            </a>{" "}
            and connect your Instagram, Facebook, and X accounts in Publer&rsquo;s UI.
          </li>
          <li>
            In Publer, open your workspace settings → <strong>API</strong> and
            generate an API token.
          </li>
          <li>
            Add to Vercel env vars (Production):
            <pre className="bg-brand-paper text-brand-ink p-2 rounded mt-1 text-xs overflow-x-auto">{`PUBLER_API_KEY=...`}</pre>
          </li>
          <li>
            Redeploy. Refresh this page. Click <strong>Test connection</strong>.
            If the test errors with anything mentioning a workspace, you also
            need to add{" "}
            <code className="bg-brand-paper px-1 rounded">PUBLER_WORKSPACE_ID</code>{" "}
            — find it by inspecting the network tab in Publer&rsquo;s web UI
            (look for the <code>Publer-Workspace-Id</code> header on any API
            request the page makes), then add that value as another env var and
            redeploy.
          </li>
          <li>Click Sync accounts. Then map each Publer account to one of our channels.</li>
        </ol>
      </details>
    </div>
  );
}
