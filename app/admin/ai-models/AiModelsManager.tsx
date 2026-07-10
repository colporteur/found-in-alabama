"use client";

// Admin → AI Models — edits the AI Gateway's routing table (aliases, app
// defaults, global default) via /api/admin/ai-models. Model ids come from
// the gateway's live OpenRouter catalog, so new models appear here the
// day OpenRouter adds them.

import { useCallback, useEffect, useMemo, useState } from "react";

type Routing = {
  default: string;
  aliases: Record<string, string>;
  apps: Record<string, string>;
};

type ModelInfo = {
  id: string;
  name?: string;
  prompt_price?: string;
  completion_price?: string;
  vision?: boolean;
};

// What each known alias/app powers — annotation only; unknown names still
// render and work fine.
const ALIAS_NOTES: Record<string, string> = {
  "fia-drafts": "FiA: haul drafts + newsletter",
  "fia-social": "FiA: social posts",
  "fia-cheap": "FiA: categorizer · similar items · voice-memo split",
  pricing: "Nifty: BIN pricing + helper calls",
  vision: "Artwork Evaluator (planned)",
  "cheap-bulk": "General budget alias",
};
const APP_NOTES: Record<string, string> = {
  nifty: "Nifty BIN Price Recommender extension",
  "found-in-alabama": "This site (only used if a call omits its model)",
  "artwork-evaluator": "Artwork Evaluator worker",
};

// Aliases FiA's code references — offered as one-click additions when
// missing from the table (e.g. first visit after the alias migration).
const EXPECTED_ALIASES: Record<string, string> = {
  "fia-drafts": "anthropic/claude-sonnet-5",
  "fia-social": "anthropic/claude-sonnet-5",
  "fia-cheap": "anthropic/claude-haiku-4.5",
};

function perMTok(price?: string): string | null {
  const n = Number(price);
  if (!Number.isFinite(n) || n <= 0) return null;
  return (n * 1_000_000).toFixed(2);
}

export default function AiModelsManager() {
  const [routing, setRouting] = useState<Routing | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const [newAlias, setNewAlias] = useState({ name: "", target: "" });

  const load = useCallback(async () => {
    setStatus(null);
    try {
      const res = await fetch("/api/admin/ai-models");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setRouting({
        default: data.routing.default ?? "",
        aliases: data.routing.aliases ?? {},
        apps: data.routing.apps ?? {},
      });
      setModels(data.models ?? []);
      setDirty(false);
    } catch (e) {
      setStatus({ kind: "err", msg: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const modelIndex = useMemo(() => {
    const m = new Map<string, ModelInfo>();
    for (const info of models) m.set(info.id, info);
    return m;
  }, [models]);

  const missingExpected = useMemo(() => {
    if (!routing) return [];
    return Object.keys(EXPECTED_ALIASES).filter((k) => !(k in routing.aliases));
  }, [routing]);

  function mutate(fn: (r: Routing) => Routing) {
    setRouting((r) => (r ? fn(structuredClone(r)) : r));
    setDirty(true);
    setStatus(null);
  }

  // Follow alias chains (≤5 hops, same as the gateway) to show what a
  // value actually resolves to.
  function resolve(value: string): string {
    if (!routing) return value;
    let name = value;
    for (let i = 0; i < 5 && routing.aliases[name]; i++) name = routing.aliases[name];
    if (name && !name.includes("/")) return routing.default;
    return name;
  }

  async function save() {
    if (!routing) return;
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch("/api/admin/ai-models", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(routing),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setDirty(false);
      setStatus({ kind: "ok", msg: "Saved — live on the next AI call." });
    } catch (e) {
      setStatus({ kind: "err", msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  if (!routing) {
    return (
      <p className="text-brand-ink/60">
        {status ? <span className="text-red-700">{status.msg}</span> : "Loading routing table…"}
      </p>
    );
  }

  const inputCls =
    "border border-brand-ink/20 rounded px-2 py-1.5 text-sm bg-white w-full font-mono";

  return (
    <div className="max-w-3xl">
      <datalist id="or-models">
        {models.map((m) => {
          const inP = perMTok(m.prompt_price);
          const outP = perMTok(m.completion_price);
          const price = inP && outP ? ` — $${inP} / $${outP} per MTok` : "";
          return (
            <option key={m.id} value={m.id}>
              {(m.name || m.id) + price + (m.vision ? " · vision" : "")}
            </option>
          );
        })}
      </datalist>

      {missingExpected.length > 0 && (
        <div className="mb-6 border border-brand-yellow bg-brand-yellow/10 rounded-lg p-4 text-sm">
          <p className="mb-2">
            The site&apos;s code expects these aliases, but they aren&apos;t in the
            routing table yet:
          </p>
          <ul className="mb-3 list-disc list-inside">
            {missingExpected.map((k) => (
              <li key={k}>
                <code>{k}</code> → <code>{EXPECTED_ALIASES[k]}</code>{" "}
                <span className="text-brand-ink/60">({ALIAS_NOTES[k]})</span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="border border-brand-ink/30 rounded px-3 py-1 hover:border-brand-yellow"
            onClick={() =>
              mutate((r) => {
                for (const k of missingExpected) r.aliases[k] = EXPECTED_ALIASES[k];
                return r;
              })
            }
          >
            Add them (then Save)
          </button>
          <p className="mt-2 text-brand-ink/60">
            Until saved, calls using a missing alias fall back to the global default.
          </p>
        </div>
      )}

      <Section
        title="Global default"
        hint="Used when a call names no model, or names an alias that doesn't exist."
      >
        <div className="grid grid-cols-[1fr_auto] gap-3 items-center">
          <input
            className={inputCls}
            list="or-models"
            value={routing.default}
            onChange={(e) => mutate((r) => ((r.default = e.target.value), r))}
          />
          <Resolved value={resolve(routing.default)} modelIndex={modelIndex} />
        </div>
      </Section>

      <Section
        title="Aliases"
        hint="Logical names your apps request. Point one at a different model and every caller updates instantly. Targets may be model ids or other aliases."
      >
        <div className="flex flex-col gap-2">
          {Object.entries(routing.aliases).map(([name, target]) => (
            <div
              key={name}
              className="grid grid-cols-[9rem_1fr_auto_auto] gap-3 items-center"
            >
              <div>
                <code className="text-sm">{name}</code>
                {ALIAS_NOTES[name] && (
                  <p className="text-xs text-brand-ink/50">{ALIAS_NOTES[name]}</p>
                )}
              </div>
              <input
                className={inputCls}
                list="or-models"
                value={target}
                onChange={(e) =>
                  mutate((r) => ((r.aliases[name] = e.target.value), r))
                }
              />
              <Resolved value={resolve(target)} modelIndex={modelIndex} />
              <button
                type="button"
                title="Delete alias"
                className="text-brand-ink/40 hover:text-red-700 text-sm"
                onClick={() =>
                  mutate((r) => (delete r.aliases[name], r))
                }
              >
                ✕
              </button>
            </div>
          ))}
          <div className="grid grid-cols-[9rem_1fr_auto] gap-3 items-center mt-2 pt-3 border-t border-brand-ink/10">
            <input
              className={inputCls}
              placeholder="new-alias-name"
              value={newAlias.name}
              onChange={(e) => setNewAlias({ ...newAlias, name: e.target.value })}
            />
            <input
              className={inputCls}
              list="or-models"
              placeholder="target model id or alias"
              value={newAlias.target}
              onChange={(e) => setNewAlias({ ...newAlias, target: e.target.value })}
            />
            <button
              type="button"
              className="border border-brand-ink/30 rounded px-3 py-1.5 text-sm hover:border-brand-yellow disabled:opacity-40"
              disabled={!newAlias.name.trim() || !newAlias.target.trim()}
              onClick={() => {
                mutate((r) => {
                  r.aliases[newAlias.name.trim()] = newAlias.target.trim();
                  return r;
                });
                setNewAlias({ name: "", target: "" });
              }}
            >
              Add
            </button>
          </div>
        </div>
      </Section>

      <Section
        title="App defaults"
        hint="Model used when an app sends a request without naming one (matched by the request's x-app header)."
      >
        <div className="flex flex-col gap-2">
          {Object.entries(routing.apps).map(([app, target]) => (
            <div
              key={app}
              className="grid grid-cols-[9rem_1fr_auto] gap-3 items-center"
            >
              <div>
                <code className="text-sm">{app}</code>
                {APP_NOTES[app] && (
                  <p className="text-xs text-brand-ink/50">{APP_NOTES[app]}</p>
                )}
              </div>
              <input
                className={inputCls}
                list="or-models"
                value={target}
                onChange={(e) => mutate((r) => ((r.apps[app] = e.target.value), r))}
              />
              <Resolved value={resolve(target)} modelIndex={modelIndex} />
            </div>
          ))}
        </div>
      </Section>

      <div className="flex items-center gap-4 mt-8">
        <button
          type="button"
          onClick={save}
          disabled={busy || !dirty}
          className="bg-brand-ink text-white rounded px-5 py-2 text-sm disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save changes"}
        </button>
        <button
          type="button"
          onClick={load}
          disabled={busy}
          className="text-sm text-brand-ink/60 hover:text-brand-ink"
        >
          Discard / reload
        </button>
        {status && (
          <span
            className={
              status.kind === "ok" ? "text-sm text-green-700" : "text-sm text-red-700"
            }
          >
            {status.msg}
          </span>
        )}
        {dirty && !status && (
          <span className="text-sm text-brand-ink/50">Unsaved changes</span>
        )}
      </div>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-8 bg-white border border-brand-ink/15 rounded-lg p-5">
      <h2 className="font-medium mb-1">{title}</h2>
      <p className="text-xs text-brand-ink/50 mb-4 max-w-prose">{hint}</p>
      {children}
    </div>
  );
}

function Resolved({
  value,
  modelIndex,
}: {
  value: string;
  modelIndex: Map<string, ModelInfo>;
}) {
  const info = modelIndex.get(value);
  const inP = perMTok(info?.prompt_price);
  const outP = perMTok(info?.completion_price);
  const known = modelIndex.size === 0 || !!info || !value.includes("/");
  return (
    <span
      className="text-xs text-brand-ink/50 whitespace-nowrap"
      title={value}
    >
      {inP && outP ? (
        <>
          ${inP} / ${outP} MTok
        </>
      ) : known ? (
        "→ " + (value.split("/").pop() ?? value)
      ) : (
        <span className="text-red-700">unknown model id</span>
      )}
    </span>
  );
}
