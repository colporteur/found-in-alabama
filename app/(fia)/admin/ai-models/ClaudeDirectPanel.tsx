"use client";

// Admin → AI Models → Claude direct. The on/off switch that sends the
// gateway's chat traffic straight to Anthropic (using the Claude plan's
// monthly API credit) instead of OpenRouter, plus which Claude model each
// routed model runs as while it is on. Talks to
// /api/admin/ai-models/provider. The switch saves at once; the model
// choices save with their own button. Neither touches the routing table.

import { useCallback, useEffect, useMemo, useState } from "react";

type Routing = {
  default: string;
  aliases: Record<string, string>;
  apps: Record<string, string>;
};

type ProviderState = {
  anthropic: boolean;
  key_present: boolean;
  cheap: string;
  standard: string;
  map: Record<string, string>;
  paused: boolean;
  paused_until: string | null;
  last_fallback: { at: string; status: number; model: string; detail?: string } | null;
};

type ClaudeModel = { id: string; name?: string };

// Same rule the gateway applies (worker.js toAnthropicModel) when a model
// has no exact entry: Claude ids are rewritten, small models from other
// makers become `cheap`, everything else becomes `standard`.
function autoModel(id: string, cheap: string, standard: string): string {
  if (id.startsWith("anthropic/")) {
    return id.slice("anthropic/".length).replace(/:.*$/, "").replace(/\./g, "-");
  }
  if (id.startsWith("claude-") && !id.includes("/")) return id;
  return /flash|mini|nano|lite|haiku|small|8b/i.test(id) ? cheap : standard;
}

export default function ClaudeDirectPanel({ routing }: { routing: Routing }) {
  const [state, setState] = useState<ProviderState | null>(null);
  const [claudeModels, setClaudeModels] = useState<ClaudeModel[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [cheap, setCheap] = useState("");
  const [standard, setStandard] = useState("");
  const [map, setMap] = useState<Record<string, string>>({});
  const [newRow, setNewRow] = useState({ from: "", to: "" });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  const apply = useCallback((s: ProviderState) => {
    setState(s);
    setCheap(s.cheap ?? "");
    setStandard(s.standard ?? "");
    setMap(s.map ?? {});
    setDirty(false);
  }, []);

  const load = useCallback(async () => {
    setStatus(null);
    try {
      const res = await fetch("/api/admin/ai-models/provider");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      apply(data.state as ProviderState);
      setClaudeModels(data.models ?? []);
      setModelsError(data.modelsError ?? null);
    } catch (e) {
      setStatus({ kind: "err", msg: e instanceof Error ? e.message : String(e) });
    }
  }, [apply]);

  useEffect(() => {
    load();
  }, [load]);

  async function put(body: Record<string, unknown>, okMsg: string) {
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch("/api/admin/ai-models/provider", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      return { state: data.state as ProviderState, okMsg };
    } catch (e) {
      setStatus({ kind: "err", msg: e instanceof Error ? e.message : String(e) });
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function setSwitch(on: boolean) {
    const r = await put(
      { anthropic: on },
      on ? "On — chat calls now go to Claude directly." : "Off — everything is back on OpenRouter."
    );
    if (!r) return;
    // Keep any unsaved model edits on screen; only the switch changed.
    setState(r.state);
    setStatus({ kind: "ok", msg: r.okMsg });
  }

  async function saveModels() {
    const r = await put({ cheap, standard, map }, "Saved — live on the next AI call.");
    if (!r) return;
    apply(r.state);
    setStatus({ kind: "ok", msg: r.okMsg });
  }

  // Every real model the routing table can resolve to, with what uses it.
  const rows = useMemo(() => {
    const resolve = (value: string): string => {
      let name = value;
      for (let i = 0; i < 5 && routing.aliases[name]; i++) name = routing.aliases[name];
      if (name && !name.includes("/")) {
        name = routing.default;
        for (let i = 0; i < 5 && routing.aliases[name]; i++) name = routing.aliases[name];
      }
      return name;
    };
    const usedBy = new Map<string, string[]>();
    const add = (label: string, value: string) => {
      const id = resolve(value);
      if (!id) return;
      usedBy.set(id, [...(usedBy.get(id) ?? []), label]);
    };
    add("global default", routing.default);
    for (const [name, target] of Object.entries(routing.aliases)) add(name, target);
    for (const [app, target] of Object.entries(routing.apps)) add(`app: ${app}`, target);
    // Exact entries saved for models that are not in the routing table.
    for (const id of Object.keys(map)) if (!usedBy.has(id)) usedBy.set(id, []);
    return Array.from(usedBy.entries()).map(([id, labels]) => ({ id, labels }));
  }, [routing, map]);

  const known = useMemo(() => new Set(claudeModels.map((m) => m.id)), [claudeModels]);

  function setRow(id: string, value: string) {
    setMap((m) => {
      const next = { ...m };
      if (value.trim()) next[id] = value;
      else delete next[id];
      return next;
    });
    setDirty(true);
    setStatus(null);
  }

  const inputCls =
    "border border-brand-ink/20 rounded px-2 py-1.5 text-sm bg-white w-full font-mono";

  if (!state) {
    return (
      <div className="mb-8 bg-white border border-brand-ink/15 rounded-lg p-5">
        <h2 className="font-medium mb-1">Claude direct</h2>
        <p className="text-sm text-brand-ink/60">
          {status ? <span className="text-red-700">{status.msg}</span> : "Loading…"}
        </p>
      </div>
    );
  }

  const on = state.anthropic;

  return (
    <div className="mb-8 bg-white border border-brand-ink/15 rounded-lg p-5">
      <datalist id="claude-models">
        {claudeModels.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name || m.id}
          </option>
        ))}
      </datalist>

      <div className="flex flex-wrap items-center gap-3 mb-1">
        <h2 className="font-medium">Claude direct</h2>
        <span
          className={
            "text-xs rounded px-2 py-0.5 " +
            (on ? "bg-green-700 text-white" : "bg-brand-ink/10 text-brand-ink/70")
          }
        >
          {on ? "ON" : "OFF"}
        </span>
        <button
          type="button"
          onClick={() => setSwitch(!on)}
          disabled={busy || (!on && !state.key_present)}
          className="border border-brand-ink/30 rounded px-3 py-1 text-sm hover:border-brand-yellow disabled:opacity-40"
        >
          {on ? "Turn off" : "Turn on"}
        </button>
      </div>
      <p className="text-xs text-brand-ink/50 mb-4 max-w-prose">
        On: chat calls go straight to Anthropic and draw on the Claude plan&apos;s
        monthly API credit; anything Anthropic refuses, including a used-up credit,
        goes to OpenRouter as usual. Off: everything goes to OpenRouter. Embeddings,
        transcription and image segmentation never switch. This switch saves at once
        and is separate from the routing table below.
      </p>

      {!state.key_present && (
        <p className="text-sm text-red-700 mb-3">
          No Anthropic key is set on the gateway yet, so this can&apos;t be turned on.
        </p>
      )}
      {state.paused && state.paused_until && (
        <p className="text-sm text-red-700 mb-3">
          Paused until {new Date(state.paused_until).toLocaleString()}: Anthropic reported
          the credit as used up, so OpenRouter is answering. Turning it off and on again
          retries Anthropic straight away.
        </p>
      )}
      {state.last_fallback && (
        <p className="text-xs text-brand-ink/60 mb-3 max-w-prose">
          Last fallback to OpenRouter: {new Date(state.last_fallback.at).toLocaleString()}{" "}
          (HTTP {state.last_fallback.status}, <code>{state.last_fallback.model}</code>)
          {state.last_fallback.detail ? ` — ${state.last_fallback.detail}` : ""}
        </p>
      )}

      <h3 className="font-medium text-sm mt-5 mb-1">Which Claude model runs</h3>
      <p className="text-xs text-brand-ink/50 mb-3 max-w-prose">
        One row for each model the routing table below resolves to. Leave a box empty
        to use the automatic choice shown in grey, or pick a Claude model to use
        instead while Claude direct is on.
      </p>
      {modelsError && (
        <p className="text-xs text-brand-ink/60 mb-3">
          Couldn&apos;t load the list of Claude models ({modelsError}); ids can still be
          typed by hand.
        </p>
      )}
      <div className="flex flex-col gap-2">
        {rows.map(({ id, labels }) => {
          const auto = autoModel(id, cheap, standard);
          const effective = (map[id] ?? "").trim() || auto;
          const unknown = known.size > 0 && !known.has(effective);
          return (
            <div key={id} className="grid grid-cols-[1fr_1fr] gap-3 items-start">
              <div>
                <code className="text-sm break-all">{id}</code>
                <p className="text-xs text-brand-ink/50">
                  {labels.length ? labels.join(" · ") : "not in the routing table"}
                </p>
              </div>
              <div>
                <input
                  className={inputCls}
                  list="claude-models"
                  placeholder={auto}
                  value={map[id] ?? ""}
                  onChange={(e) => setRow(id, e.target.value)}
                />
                {unknown && (
                  <p className="text-xs text-red-700 mt-1">
                    <code>{effective}</code> isn&apos;t in your Anthropic model list — these
                    calls would fall back to OpenRouter. Pick one from the list.
                  </p>
                )}
              </div>
            </div>
          );
        })}
        <div className="grid grid-cols-[1fr_1fr_auto] gap-3 items-center mt-2 pt-3 border-t border-brand-ink/10">
          <input
            className={inputCls}
            list="or-models"
            placeholder="another OpenRouter model id"
            value={newRow.from}
            onChange={(e) => setNewRow({ ...newRow, from: e.target.value })}
          />
          <input
            className={inputCls}
            list="claude-models"
            placeholder="Claude model to run instead"
            value={newRow.to}
            onChange={(e) => setNewRow({ ...newRow, to: e.target.value })}
          />
          <button
            type="button"
            className="border border-brand-ink/30 rounded px-3 py-1.5 text-sm hover:border-brand-yellow disabled:opacity-40"
            disabled={!newRow.from.trim() || !newRow.to.trim()}
            onClick={() => {
              setRow(newRow.from.trim(), newRow.to.trim());
              setNewRow({ from: "", to: "" });
            }}
          >
            Add
          </button>
        </div>
      </div>

      <h3 className="font-medium text-sm mt-6 mb-1">Stand-ins for other makers&apos; models</h3>
      <p className="text-xs text-brand-ink/50 mb-3 max-w-prose">
        Used for any Gemini, OpenAI or other non-Claude model without its own row above,
        including models picked in the Enhance dropdowns.
      </p>
      <div className="grid grid-cols-[1fr_1fr] gap-3">
        <label className="text-xs text-brand-ink/60">
          Small models (flash, mini, nano, lite…)
          <input
            className={inputCls + " mt-1"}
            list="claude-models"
            value={cheap}
            onChange={(e) => {
              setCheap(e.target.value);
              setDirty(true);
              setStatus(null);
            }}
          />
        </label>
        <label className="text-xs text-brand-ink/60">
          Everything else
          <input
            className={inputCls + " mt-1"}
            list="claude-models"
            value={standard}
            onChange={(e) => {
              setStandard(e.target.value);
              setDirty(true);
              setStatus(null);
            }}
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-4 mt-5">
        <button
          type="button"
          onClick={saveModels}
          disabled={busy || !dirty || !cheap.trim() || !standard.trim()}
          className="bg-brand-ink text-white rounded px-5 py-2 text-sm disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save Claude models"}
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
        {dirty && !status && <span className="text-sm text-brand-ink/50">Unsaved changes</span>}
      </div>
    </div>
  );
}
