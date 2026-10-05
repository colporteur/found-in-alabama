"use client";

// Address list + "new address" form for /admin/mail/addresses. All writes
// go through /api/admin/email/*, which push to Cloudflare immediately;
// router.refresh() then reloads server data (sync status, destination
// verification).

import { useState } from "react";
import { useRouter } from "next/navigation";

type Mode = "inbox" | "forward" | "both";

type Addr = {
  id: string;
  address: string;
  domain: string;
  mode: Mode;
  forwardTo: string | null;
  label: string | null;
  enabled: boolean;
  syncStatus: string;
  syncError: string | null;
};

type DomainStatus = {
  domain: string;
  ok: boolean;
  routingEnabled: boolean;
  routingStatus: string | null;
  catchAll: string | null;
  error: string | null;
};

const MODE_LABELS: Record<Mode, string> = {
  inbox: "Site inbox",
  forward: "Forward only",
  both: "Site inbox + forward",
};

const MODE_HELP: Record<Mode, string> = {
  inbox: "Mail lands in Admin → Mail on this site.",
  forward: "Cloudflare forwards it straight to another address. Nothing is kept here.",
  both: "Kept in the site inbox and also forwarded.",
};

async function api(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    destination?: { email: string; verified: boolean } | null;
    [k: string]: unknown;
  };
  if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

export default function AddressManager({
  domains,
  defaultForwardTo,
  initialAddresses,
  destinations,
  statuses,
  canEdit,
}: {
  domains: string[];
  defaultForwardTo: string;
  initialAddresses: Addr[];
  destinations: { email: string; verified: boolean }[];
  statuses: DomainStatus[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const destMap = new Map(destinations.map((d) => [d.email, d.verified]));

  // New-address form
  const [localPart, setLocalPart] = useState("");
  const [domain, setDomain] = useState(domains[0] ?? "");
  const [mode, setMode] = useState<Mode>("inbox");
  const [forwardTo, setForwardTo] = useState(defaultForwardTo);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const data = await api("/api/admin/email/addresses", "POST", {
        localPart,
        domain,
        mode,
        forwardTo: mode === "inbox" ? null : forwardTo,
        label,
      });
      const created = data.address as Addr;
      let text = `Created ${created.address}.`;
      if (created.syncStatus === "error") {
        text += ` Cloudflare didn't accept the rule yet: ${created.syncError}. Use Retry below.`;
      }
      if (data.destination && !data.destination.verified) {
        text += ` Cloudflare sent a verification email to ${data.destination.email}. Forwarding starts after you click its link.`;
      }
      setMsg({ kind: created.syncStatus === "error" ? "err" : "ok", text });
      setLocalPart("");
      setLabel("");
      router.refresh();
    } catch (err) {
      setMsg({ kind: "err", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function importExisting() {
    setBusy(true);
    setMsg(null);
    try {
      const data = (await api("/api/admin/email/import", "POST")) as unknown as {
        imported: string[];
        linked: string[];
        skipped: { domain: string; rule: string; reason: string }[];
        errors: string[];
      };
      const parts = [
        data.imported.length
          ? `Imported ${data.imported.length}: ${data.imported.join(", ")}.`
          : "No new addresses to import.",
      ];
      if (data.linked.length) parts.push(`Re-linked ${data.linked.join(", ")}.`);
      if (data.skipped.length) {
        parts.push(
          `Left alone: ${data.skipped.map((s) => `${s.rule} (${s.reason})`).join("; ")}.`
        );
      }
      if (data.errors.length) parts.push(`Errors: ${data.errors.join("; ")}`);
      setMsg({ kind: data.errors.length ? "err" : "ok", text: parts.join(" ") });
      router.refresh();
    } catch (err) {
      setMsg({ kind: "err", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const byDomain = domains.map((d) => ({
    domain: d,
    rows: initialAddresses.filter((a) => a.domain === d),
  }));

  return (
    <div className="space-y-10">
      {/* Domain status */}
      <div className="grid gap-3 sm:grid-cols-2 max-w-3xl">
        {statuses.map((s) => (
          <div
            key={s.domain}
            className={`border rounded-lg p-4 text-sm ${
              s.ok ? "bg-white border-brand-ink/15" : "bg-amber-50 border-amber-300"
            }`}
          >
            <p className="font-medium mb-1">{s.domain}</p>
            {s.error ? (
              <p className="text-red-700">{s.error}</p>
            ) : s.routingEnabled ? (
              <p className="text-green-800">
                ✓ Email Routing on{s.routingStatus ? ` (${s.routingStatus})` : ""}
              </p>
            ) : (
              <p className="text-amber-800">
                Email Routing is off. Turn it on in Cloudflare → {s.domain} → Email
                → Email Routing. Addresses here won&rsquo;t receive mail until then.
              </p>
            )}
            {s.catchAll && (
              <p className="text-brand-ink/60 mt-1">Catch-all: {s.catchAll}</p>
            )}
          </div>
        ))}
      </div>

      {/* New address */}
      <form
        onSubmit={create}
        className="bg-white border border-brand-ink/15 rounded-lg p-5 max-w-3xl"
      >
        <h2 className="font-medium mb-4">New address</h2>
        <div className="flex flex-wrap items-center gap-1.5 mb-4">
          <input
            value={localPart}
            onChange={(e) => setLocalPart(e.target.value)}
            placeholder="orders"
            required
            disabled={!canEdit}
            className="w-48 border border-brand-ink/20 rounded-md px-3 py-2 text-sm"
          />
          <span className="text-brand-ink/60">@</span>
          <select
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            disabled={!canEdit}
            className="border border-brand-ink/20 rounded-md px-3 py-2 text-sm bg-white"
          >
            {domains.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>

        <fieldset className="mb-4">
          <legend className="text-xs uppercase tracking-wider text-brand-ink/50 mb-2">
            Delivery
          </legend>
          <div className="flex flex-wrap gap-4">
            {(Object.keys(MODE_LABELS) as Mode[]).map((m) => (
              <label key={m} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="mode"
                  value={m}
                  checked={mode === m}
                  onChange={() => setMode(m)}
                  disabled={!canEdit}
                />
                {MODE_LABELS[m]}
              </label>
            ))}
          </div>
          <p className="text-xs text-brand-ink/60 mt-2">{MODE_HELP[mode]}</p>
        </fieldset>

        {mode !== "inbox" && (
          <label className="block mb-4">
            <span className="text-xs uppercase tracking-wider text-brand-ink/50">
              Forward to
            </span>
            <input
              type="email"
              value={forwardTo}
              onChange={(e) => setForwardTo(e.target.value)}
              required
              disabled={!canEdit}
              className="mt-1 block w-full max-w-sm border border-brand-ink/20 rounded-md px-3 py-2 text-sm"
            />
            <VerifyBadge email={forwardTo.trim().toLowerCase()} destMap={destMap} />
          </label>
        )}

        <label className="block mb-5">
          <span className="text-xs uppercase tracking-wider text-brand-ink/50">
            Note (optional)
          </span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. auction houses, eBay buyers, newsletter signups"
            disabled={!canEdit}
            className="mt-1 block w-full max-w-sm border border-brand-ink/20 rounded-md px-3 py-2 text-sm"
          />
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={busy || !canEdit || !localPart.trim()}
            className="px-4 py-2 rounded-md bg-brand-ink text-white text-sm font-medium disabled:opacity-40"
          >
            {busy ? "Working…" : "Create address"}
          </button>
          <button
            type="button"
            onClick={importExisting}
            disabled={busy || !canEdit}
            className="px-4 py-2 rounded-md border border-brand-ink/20 text-sm disabled:opacity-40"
          >
            Import existing from Cloudflare
          </button>
        </div>
        {msg && (
          <p
            className={`text-sm mt-3 ${msg.kind === "err" ? "text-red-700" : "text-green-800"}`}
          >
            {msg.text}
          </p>
        )}
      </form>

      {/* Address list */}
      {byDomain.map(({ domain: d, rows }) => (
        <div key={d}>
          <h2 className="text-xs uppercase tracking-wider text-brand-earth mb-3">
            {d} · {rows.length} address{rows.length === 1 ? "" : "es"}
          </h2>
          {rows.length === 0 ? (
            <p className="text-sm text-brand-ink/50">None yet.</p>
          ) : (
            <div className="space-y-2 max-w-4xl">
              {rows.map((a) => (
                <AddressRow
                  key={a.id}
                  addr={a}
                  destMap={destMap}
                  canEdit={canEdit}
                  defaultForwardTo={defaultForwardTo}
                />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function VerifyBadge({ email, destMap }: { email: string; destMap: Map<string, boolean> }) {
  if (!email || !email.includes("@")) return null;
  const v = destMap.get(email);
  if (v === true) return <span className="block text-xs text-green-800 mt-1">✓ Verified in Cloudflare</span>;
  if (v === false)
    return (
      <span className="block text-xs text-amber-800 mt-1">
        Waiting for verification — open Cloudflare&rsquo;s email in that inbox and click the link.
      </span>
    );
  return (
    <span className="block text-xs text-brand-ink/60 mt-1">
      New destination — Cloudflare will email it a verification link.
    </span>
  );
}

function AddressRow({
  addr,
  destMap,
  canEdit,
  defaultForwardTo,
}: {
  addr: Addr;
  destMap: Map<string, boolean>;
  canEdit: boolean;
  defaultForwardTo: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<Mode>(addr.mode);
  const [forwardTo, setForwardTo] = useState(addr.forwardTo ?? defaultForwardTo);
  const [label, setLabel] = useState(addr.label ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const save = () =>
    run(async () => {
      await api(`/api/admin/email/addresses/${addr.id}`, "PATCH", {
        mode,
        forwardTo: mode === "inbox" ? null : forwardTo,
        label,
      });
      setEditing(false);
    });

  const toggle = () =>
    run(() => api(`/api/admin/email/addresses/${addr.id}`, "PATCH", { enabled: !addr.enabled }));

  const retry = () => run(() => api(`/api/admin/email/addresses/${addr.id}/resync`, "POST"));

  const remove = () => {
    if (
      !confirm(
        `Remove ${addr.address}? Mail to it will stop being delivered. Messages already in the inbox are kept.`
      )
    )
      return;
    run(() => api(`/api/admin/email/addresses/${addr.id}`, "DELETE"));
  };

  async function copy() {
    try {
      await navigator.clipboard.writeText(addr.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — ignore */
    }
  }

  const fwdVerified = addr.forwardTo ? destMap.get(addr.forwardTo) : undefined;

  return (
    <div
      className={`bg-white border rounded-lg p-4 ${
        addr.syncStatus === "error" ? "border-red-300" : "border-brand-ink/15"
      } ${addr.enabled ? "" : "opacity-60"}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium break-all">
            {addr.address}{" "}
            <button
              type="button"
              onClick={copy}
              className="text-xs text-brand-ink/50 hover:text-brand-ink ml-1"
            >
              {copied ? "copied" : "copy"}
            </button>
          </p>
          {addr.label && <p className="text-sm text-brand-ink/60">{addr.label}</p>}
          <p className="text-sm mt-1">
            {MODE_LABELS[addr.mode]}
            {addr.mode !== "inbox" && addr.forwardTo && (
              <>
                {" → "}
                <span className="break-all">{addr.forwardTo}</span>
                {fwdVerified === true && <span className="text-green-800"> ✓</span>}
                {fwdVerified === false && (
                  <span className="text-amber-800"> (awaiting verification)</span>
                )}
              </>
            )}
            {!addr.enabled && <span className="text-brand-ink/60"> · paused</span>}
          </p>
          {addr.syncStatus === "error" && (
            <p className="text-sm text-red-700 mt-1">Cloudflare: {addr.syncError}</p>
          )}
          {addr.syncStatus === "pending" && (
            <p className="text-sm text-amber-800 mt-1">Not yet pushed to Cloudflare.</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {addr.syncStatus !== "ok" && (
            <button
              type="button"
              onClick={retry}
              disabled={busy || !canEdit}
              className="px-3 py-1.5 rounded bg-red-700 text-white disabled:opacity-40"
            >
              Retry
            </button>
          )}
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            disabled={busy || !canEdit}
            className="px-3 py-1.5 rounded border border-brand-ink/20 disabled:opacity-40"
          >
            {editing ? "Cancel" : "Edit"}
          </button>
          <button
            type="button"
            onClick={toggle}
            disabled={busy || !canEdit}
            className="px-3 py-1.5 rounded border border-brand-ink/20 disabled:opacity-40"
          >
            {addr.enabled ? "Pause" : "Resume"}
          </button>
          <button
            type="button"
            onClick={remove}
            disabled={busy || !canEdit}
            className="px-3 py-1.5 rounded border border-red-300 text-red-700 disabled:opacity-40"
          >
            Remove
          </button>
        </div>
      </div>

      {editing && (
        <div className="mt-4 pt-4 border-t border-brand-ink/10 space-y-3">
          <div className="flex flex-wrap gap-4">
            {(Object.keys(MODE_LABELS) as Mode[]).map((m) => (
              <label key={m} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={`mode-${addr.id}`}
                  checked={mode === m}
                  onChange={() => setMode(m)}
                />
                {MODE_LABELS[m]}
              </label>
            ))}
          </div>
          {mode !== "inbox" && (
            <label className="block">
              <span className="text-xs uppercase tracking-wider text-brand-ink/50">
                Forward to
              </span>
              <input
                type="email"
                value={forwardTo}
                onChange={(e) => setForwardTo(e.target.value)}
                className="mt-1 block w-full max-w-sm border border-brand-ink/20 rounded-md px-3 py-2 text-sm"
              />
              <VerifyBadge email={forwardTo.trim().toLowerCase()} destMap={destMap} />
            </label>
          )}
          <label className="block">
            <span className="text-xs uppercase tracking-wider text-brand-ink/50">Note</span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="mt-1 block w-full max-w-sm border border-brand-ink/20 rounded-md px-3 py-2 text-sm"
            />
          </label>
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="px-4 py-2 rounded-md bg-brand-ink text-white text-sm font-medium disabled:opacity-40"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      )}
      {err && <p className="text-sm text-red-700 mt-2">{err}</p>}
    </div>
  );
}
