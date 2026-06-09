"use client";

// Pinterest connection card on /admin/settings/posting. Shows connected
// state, board list with default selector, and action buttons (connect,
// disconnect, sync boards). Initial data comes from the server; mutations
// hit the /api/admin/pinterest/* routes and patch local state.

import { useState } from "react";

export type BoardOption = {
  boardId: string;
  name: string;
  privacy: string | null;
  pinCount: number | null;
  isDefault: boolean;
};

export default function PinterestConnectionCard({
  configured,
  connected,
  username,
  accessExpiresAt,
  refreshExpiresAt,
  initialBoards,
  oauthIssue,
}: {
  configured: boolean;
  connected: boolean;
  username: string | null;
  accessExpiresAt: string | null;
  refreshExpiresAt: string | null;
  initialBoards: BoardOption[];
  oauthIssue: string | null;
}) {
  const [boards, setBoards] = useState<BoardOption[]>(initialBoards);
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<
    { kind: "ok" | "error"; msg: string } | null
  >(null);

  async function disconnect() {
    if (!confirm("Disconnect Pinterest? You'll need to reconnect to post.")) return;
    setBusy("disconnect");
    try {
      const res = await fetch("/api/admin/pinterest/disconnect", {
        method: "POST",
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error ?? `HTTP ${res.status}`);
      }
      // Reload so the rest of the page reflects disconnected state.
      window.location.reload();
    } catch (err) {
      setFlash({
        kind: "error",
        msg: err instanceof Error ? err.message : "Disconnect failed",
      });
    } finally {
      setBusy(null);
    }
  }

  async function syncBoards() {
    setBusy("sync");
    setFlash(null);
    try {
      const res = await fetch("/api/admin/pinterest/boards/sync", {
        method: "POST",
      });
      const data = (await res.json()) as { boardCount?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setFlash({
        kind: "ok",
        msg: `Synced ${data.boardCount ?? 0} board${data.boardCount === 1 ? "" : "s"}.`,
      });
      // The fresh state is in the DB; reload to pull it.
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

  async function setDefault(boardId: string) {
    setBusy(`default:${boardId}`);
    setFlash(null);
    try {
      const res = await fetch("/api/admin/pinterest/boards/default", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ boardId }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error ?? `HTTP ${res.status}`);
      }
      setBoards((prev) =>
        prev.map((b) => ({ ...b, isDefault: b.boardId === boardId }))
      );
    } catch (err) {
      setFlash({
        kind: "error",
        msg: err instanceof Error ? err.message : "Update failed",
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="border border-brand-ink/15 rounded-lg p-5 bg-white">
      <div className="flex items-baseline justify-between mb-3 gap-3">
        <h3 className="font-marker text-lg">Pinterest</h3>
        {!configured ? (
          <span className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-900 font-medium">
            Needs setup
          </span>
        ) : !connected ? (
          <span className="text-xs px-2 py-0.5 rounded bg-brand-ink/10 text-brand-ink/70 font-medium">
            Not connected
          </span>
        ) : (
          <span className="text-xs px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-medium">
            Connected
          </span>
        )}
      </div>
      <p className="text-xs uppercase tracking-wider text-brand-ink/50 mb-2">
        Handles
      </p>
      <p className="text-sm text-brand-ink/80 mb-4">Pinterest pin</p>

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
          {oauthIssue ?? "Pinterest env vars missing."}
        </div>
      )}

      {configured && !connected && (
        <a
          href="/api/admin/pinterest/oauth/start"
          className="inline-flex items-center px-4 py-2 bg-brand-yellow text-brand-ink font-medium rounded-md hover:bg-brand-yellow-dark transition-colors text-sm"
        >
          Connect Pinterest →
        </a>
      )}

      {connected && (
        <div className="space-y-4">
          <div className="text-sm space-y-1">
            {username && (
              <p className="text-brand-ink/80">
                Account: <span className="font-medium">@{username}</span>
              </p>
            )}
            {accessExpiresAt && (
              <p className="text-xs text-brand-ink/55">
                Access token expires {new Date(accessExpiresAt).toLocaleString()}{" "}
                (auto-refreshes)
              </p>
            )}
            {refreshExpiresAt && (
              <p className="text-xs text-brand-ink/55">
                Refresh token expires {new Date(refreshExpiresAt).toLocaleString()}{" "}
                — re-connect before then
              </p>
            )}
          </div>

          <div>
            <div className="flex items-baseline justify-between mb-2">
              <p className="text-xs uppercase tracking-wider text-brand-ink/55 font-medium">
                Boards ({boards.length}) · default gets posts that don&rsquo;t
                match Claude&rsquo;s suggestion
              </p>
              <button
                onClick={syncBoards}
                disabled={busy === "sync"}
                className="text-xs px-3 py-1 border border-brand-ink/20 rounded hover:bg-brand-ink/5 transition-colors disabled:opacity-50"
              >
                {busy === "sync" ? "Syncing…" : "Sync boards"}
              </button>
            </div>
            {boards.length === 0 ? (
              <p className="text-sm text-brand-ink/60 italic">
                No boards cached. Click &ldquo;Sync boards.&rdquo;
              </p>
            ) : (
              <ul className="border border-brand-ink/10 rounded divide-y divide-brand-ink/10 max-h-64 overflow-y-auto">
                {boards.map((b) => (
                  <li
                    key={b.boardId}
                    className="flex items-center justify-between gap-2 px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">
                        {b.name}{" "}
                        {b.isDefault && (
                          <span className="text-xs text-brand-earth uppercase tracking-wider ml-1">
                            default
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-brand-ink/55">
                        {b.privacy ?? "—"} · {b.pinCount ?? 0} pins
                      </p>
                    </div>
                    {!b.isDefault && (
                      <button
                        onClick={() => setDefault(b.boardId)}
                        disabled={busy === `default:${b.boardId}`}
                        className="text-xs px-2 py-1 border border-brand-ink/20 rounded hover:bg-brand-ink/5 transition-colors disabled:opacity-50 shrink-0"
                      >
                        Make default
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex gap-2 pt-3 border-t border-brand-ink/10">
            <a
              href="/api/admin/pinterest/oauth/start"
              className="text-sm px-3 py-1.5 border border-brand-ink/20 rounded hover:bg-brand-ink/5 transition-colors"
            >
              Reconnect
            </a>
            <button
              onClick={disconnect}
              disabled={busy === "disconnect"}
              className="text-sm px-3 py-1.5 border border-red-200 text-red-700 rounded hover:bg-red-50 transition-colors disabled:opacity-50"
            >
              {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
            </button>
          </div>
        </div>
      )}

      <details className="mt-4 text-sm">
        <summary className="cursor-pointer text-brand-ink/70 hover:text-brand-ink">
          Setup instructions
        </summary>
        <ol className="mt-3 space-y-2 list-decimal list-inside text-brand-ink/85">
          <li>
            Sign in at{" "}
            <a
              href="https://developers.pinterest.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-brand-yellow decoration-2 underline-offset-2"
            >
              developers.pinterest.com
            </a>{" "}
            and create a new app (call it &ldquo;Found in Alabama&rdquo;).
          </li>
          <li>
            In the app&rsquo;s settings, add this redirect URI exactly:
            <pre className="bg-brand-paper text-brand-ink p-2 rounded mt-1 text-xs overflow-x-auto">{`https://www.foundinalabama.com/api/admin/pinterest/oauth/callback`}</pre>
          </li>
          <li>
            Copy your App ID + App secret, and generate a 32+ char random
            string for the state secret.
          </li>
          <li>
            Add to Vercel env vars (Production):
            <pre className="bg-brand-paper text-brand-ink p-2 rounded mt-1 text-xs overflow-x-auto">{`PINTEREST_CLIENT_ID=...
PINTEREST_CLIENT_SECRET=...
PINTEREST_REDIRECT_URI=https://www.foundinalabama.com/api/admin/pinterest/oauth/callback
PINTEREST_OAUTH_STATE_SECRET=<a-long-random-string>`}</pre>
          </li>
          <li>Redeploy. Refresh this page. Click Connect.</li>
        </ol>
      </details>
    </div>
  );
}
