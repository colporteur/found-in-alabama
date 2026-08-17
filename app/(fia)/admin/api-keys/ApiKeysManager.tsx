"use client";

import { useState } from "react";

type KeyRow = {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

export default function ApiKeysManager({
  initialKeys,
}: {
  initialKeys: KeyRow[];
}) {
  const [keys, setKeys] = useState<KeyRow[]>(initialKeys);
  const [newKeyName, setNewKeyName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justCreated, setJustCreated] = useState<{
    plaintext: string;
    name: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!newKeyName.trim()) {
      setError("Give the key a name (e.g. 'Chrome on desktop').");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/admin/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newKeyName.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as {
        plaintext: string;
        row: KeyRow;
      };
      setJustCreated({ plaintext: data.plaintext, name: data.row.name });
      setKeys((prev) => [data.row, ...prev]);
      setNewKeyName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create key");
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    if (!confirm("Revoke this key? The extension using it will stop working.")) return;
    try {
      const res = await fetch(`/api/admin/api-keys/${id}/revoke`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setKeys((prev) =>
        prev.map((k) =>
          k.id === id ? { ...k, revokedAt: new Date().toISOString() } : k
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke key");
    }
  }

  async function handleCopy() {
    if (!justCreated) return;
    try {
      await navigator.clipboard.writeText(justCreated.plaintext);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallthrough — user can copy manually from the visible textarea
    }
  }

  return (
    <div className="space-y-8">
      {/* Create-new form */}
      <div className="bg-white border border-brand-ink/15 rounded-lg p-5">
        <form onSubmit={handleCreate} className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[200px]">
            <label
              htmlFor="key-name"
              className="block text-sm font-medium mb-2"
            >
              New key
              <span className="text-brand-ink/50 font-normal ml-2">
                What's this key for?
              </span>
            </label>
            <input
              id="key-name"
              type="text"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="e.g. Chrome on desktop"
              className="w-full px-4 py-3 border border-brand-ink/20 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand-yellow"
            />
          </div>
          <button
            type="submit"
            disabled={creating || !newKeyName.trim()}
            className="px-5 py-3 bg-brand-yellow text-brand-ink font-medium rounded-md hover:bg-brand-yellow-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {creating ? "Generating…" : "Generate key"}
          </button>
        </form>
        {error && (
          <div className="mt-3 bg-red-50 border border-red-200 rounded p-3 text-sm text-red-900">
            {error}
          </div>
        )}
      </div>

      {/* One-time plaintext display */}
      {justCreated && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-md p-5">
          <p className="font-medium mb-2">
            Key &ldquo;{justCreated.name}&rdquo; created — copy it now
          </p>
          <p className="text-sm text-brand-ink/80 mb-3">
            This is the only time the full key is shown. Paste it into your
            Chrome extension settings, then close this banner. If you lose
            it, revoke this key and generate a new one.
          </p>
          <textarea
            readOnly
            value={justCreated.plaintext}
            rows={2}
            className="w-full px-3 py-2 font-mono text-xs bg-white border border-emerald-200 rounded resize-none"
            onClick={(e) => (e.target as HTMLTextAreaElement).select()}
          />
          <div className="flex gap-2 mt-3">
            <button
              onClick={handleCopy}
              className="text-sm px-3 py-2 bg-emerald-700 text-white rounded hover:bg-emerald-800"
            >
              {copied ? "Copied!" : "Copy to clipboard"}
            </button>
            <button
              onClick={() => setJustCreated(null)}
              className="text-sm px-3 py-2 bg-transparent text-emerald-900 border border-emerald-700 rounded hover:bg-emerald-100"
            >
              I've saved it — dismiss
            </button>
          </div>
        </div>
      )}

      {/* Keys table */}
      {keys.length === 0 ? (
        <div className="bg-white border border-dashed border-brand-ink/20 rounded-lg p-12 text-center">
          <p className="font-marker text-2xl text-brand-ink/40 mb-2">
            No keys yet.
          </p>
          <p className="text-brand-ink/60 max-w-md mx-auto">
            Use the form above to create your first one.
          </p>
        </div>
      ) : (
        <div className="bg-white border border-brand-ink/15 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-brand-paper border-b border-brand-ink/10">
              <tr className="text-left">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Prefix</th>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3 font-medium">Last used</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr
                  key={k.id}
                  className="border-b border-brand-ink/5 last:border-b-0"
                >
                  <td className="px-4 py-3">{k.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-brand-ink/70">
                    {k.prefix}…
                  </td>
                  <td className="px-4 py-3 text-brand-ink/60">
                    {new Date(k.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-brand-ink/60">
                    {k.lastUsedAt
                      ? new Date(k.lastUsedAt).toLocaleDateString()
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {k.revokedAt ? (
                      <span className="text-xs uppercase tracking-wider px-2 py-1 rounded bg-brand-ink/10 text-brand-ink/60">
                        Revoked
                      </span>
                    ) : (
                      <span className="text-xs uppercase tracking-wider px-2 py-1 rounded bg-brand-yellow/30 text-brand-ink">
                        Active
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {!k.revokedAt && (
                      <button
                        onClick={() => handleRevoke(k.id)}
                        className="text-xs text-red-700 hover:underline"
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
