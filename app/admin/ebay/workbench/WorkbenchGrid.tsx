"use client";

// Workbench action grid (Phase W2). Renders the inventory table with the
// two checkbox column-sections — Item Wiggles (price bump/discount, SKU
// rename) and Substantive Changes (specifics fill, title remix,
// description remix, APR reprice) — plus the Apply flow that turns
// checked items into Expert Enhance batches via the existing pipeline.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export type GridRow = {
  itemId: string;
  sku: string | null;
  title: string;
  price: string | null;
  thumb: string | null;
  skuClass: string;
  skuClassLabel: string;
  lastWiggle: string | null;
  lastSubstantive: string | null;
};

export type GuideOption = { id: string; name: string };

type OpKey =
  | "price_adjust"
  | "sku_rename"
  | "item_specifics"
  | "title_remix"
  | "description_remix"
  | "price_research";

type OpDef = {
  key: OpKey;
  short: string;
  label: string;
  section: "wiggle" | "substantive";
  estPerJob: number;
};

const OPS: OpDef[] = [
  { key: "price_adjust", short: "$", label: "Price bump / discount", section: "wiggle", estPerJob: 0 },
  { key: "sku_rename", short: "SKU", label: "Set SKU", section: "wiggle", estPerJob: 0 },
  { key: "item_specifics", short: "Spec", label: "Item specifics fill", section: "substantive", estPerJob: 0.001 },
  { key: "title_remix", short: "Title", label: "Title remix", section: "substantive", estPerJob: 0.005 },
  { key: "description_remix", short: "Desc", label: "Description remix", section: "substantive", estPerJob: 0.03 },
  { key: "price_research", short: "APR", label: "APR reprice", section: "substantive", estPerJob: 0.03 },
];

type Selections = Record<OpKey, string[]>;
const EMPTY_SELECTIONS: Selections = {
  price_adjust: [],
  sku_rename: [],
  item_specifics: [],
  title_remix: [],
  description_remix: [],
  price_research: [],
};

export default function WorkbenchGrid({
  rows,
  guides,
  filterQuery,
  matchingTotal,
}: {
  rows: GridRow[];
  guides: GuideOption[];
  /** Current filter params as a querystring, for the all-matching fetch. */
  filterQuery: string;
  matchingTotal: number;
}) {
  const router = useRouter();
  const [sel, setSel] = useState<Selections>(EMPTY_SELECTIONS);
  const [modalSection, setModalSection] = useState<"wiggle" | "substantive" | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Express selection: top-N most-neglected items for one op.
  const [expressN, setExpressN] = useState("25");
  const [expressOp, setExpressOp] = useState<OpKey>("price_adjust");

  async function expressSelect() {
    const n = Number(expressN);
    if (!Number.isFinite(n) || n <= 0) {
      setError("Express select: enter how many items.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const opDef = OPS.find((o) => o.key === expressOp)!;
      const expressBy = opDef.section === "substantive" ? "subst" : "wiggle";
      const qs = filterQuery ? `${filterQuery}&` : "";
      const res = await fetch(
        `/api/admin/workbench/item-ids?${qs}express=${Math.floor(n)}&expressBy=${expressBy}`
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Express select failed (${res.status})`);
        return;
      }
      const ids = data.itemIds as string[];
      setSel((prev) => ({ ...prev, [expressOp]: ids }));
      setNotice(
        `Express-selected ${ids.length} for ${opDef.label} — never-actioned first, then longest idle, oldest listings breaking ties. Includes items beyond this page.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Express select failed");
    } finally {
      setBusy(false);
    }
  }

  // Per-op "apply to ALL matching current filter" flags (resolved at create).
  const [allMatching, setAllMatching] = useState<Record<OpKey, boolean>>({
    price_adjust: false,
    sku_rename: false,
    item_specifics: false,
    title_remix: false,
    description_remix: false,
    price_research: false,
  });

  // ── Op configs (compact versions of the batch-form fields) ──
  const [priceMode, setPriceMode] = useState<"percent" | "flat">("percent");
  const [priceDelta, setPriceDelta] = useState("");
  const [priceFloor, setPriceFloor] = useState("");
  const [priceRound87, setPriceRound87] = useState(true);
  const [skuSetTo, setSkuSetTo] = useState("");
  const [specList, setSpecList] = useState("Brand, Color, Size, Material, Style, Type");
  const [specModel, setSpecModel] = useState("gemini:gemini-2.5-flash");
  const [specPhoto, setSpecPhoto] = useState(true);
  const [titleGuide, setTitleGuide] = useState("");
  const [titleModel, setTitleModel] = useState("anthropic:claude-haiku-4-5-20251001");
  const [descGuide, setDescGuide] = useState("");
  const [descModel, setDescModel] = useState("anthropic:claude-sonnet-5");
  const [remixInstructions, setRemixInstructions] = useState("");
  const [aprAnchor, setAprAnchor] = useState<"recommended" | "median">("recommended");
  const [aprMaxChange, setAprMaxChange] = useState("");

  const pageIds = useMemo(() => rows.map((r) => r.itemId), [rows]);

  function toggle(op: OpKey, itemId: string) {
    setSel((prev) => {
      const set = new Set(prev[op]);
      if (set.has(itemId)) set.delete(itemId);
      else set.add(itemId);
      return { ...prev, [op]: [...set] };
    });
  }

  function togglePage(op: OpKey) {
    setSel((prev) => {
      const set = new Set(prev[op]);
      const allOn = pageIds.every((id) => set.has(id));
      for (const id of pageIds) {
        if (allOn) set.delete(id);
        else set.add(id);
      }
      return { ...prev, [op]: [...set] };
    });
  }

  const counts = useMemo(() => {
    const c = {} as Record<OpKey, number>;
    for (const op of OPS) c[op.key] = sel[op.key].length;
    return c;
  }, [sel]);

  const sectionCount = (section: "wiggle" | "substantive") =>
    OPS.filter((o) => o.section === section).reduce(
      (s, o) => s + (counts[o.key] > 0 || allMatching[o.key] ? 1 : 0),
      0
    );

  function opConfig(op: OpKey): { config: Record<string, unknown>; modelOverride?: string; error?: string } {
    switch (op) {
      case "price_adjust": {
        const d = Number(priceDelta);
        if (!priceDelta || !Number.isFinite(d) || d === 0)
          return { config: {}, error: "Price bump: enter a non-zero delta" };
        return {
          config: {
            mode: priceMode,
            delta: d,
            ...(priceFloor ? { floor: Number(priceFloor) } : {}),
            round87: priceRound87,
          },
        };
      }
      case "sku_rename": {
        if (!skuSetTo.trim())
          return { config: {}, error: "Set SKU: enter the target SKU" };
        return { config: { mode: "set", replace: skuSetTo.trim() } };
      }
      case "item_specifics":
        return {
          config: {
            specifics: specList.split(",").map((s) => s.trim()).filter(Boolean),
            usePhoto: specPhoto,
          },
          modelOverride: specModel,
        };
      case "title_remix":
        if (!titleGuide) return { config: {}, error: "Title remix: pick a guide" };
        return {
          config: {
            guideId: titleGuide,
            ...(remixInstructions.trim() ? { instructions: remixInstructions.trim() } : {}),
          },
          modelOverride: titleModel,
        };
      case "description_remix":
        if (!descGuide) return { config: {}, error: "Description remix: pick a guide" };
        return {
          config: {
            guideId: descGuide,
            ...(remixInstructions.trim() ? { instructions: remixInstructions.trim() } : {}),
          },
          modelOverride: descModel,
        };
      case "price_research":
        return {
          config: {
            anchor: aprAnchor,
            round87: true,
            ...(aprMaxChange ? { maxChangePct: Number(aprMaxChange) } : {}),
          },
        };
    }
  }

  async function applySection(section: "wiggle" | "substantive") {
    const activeOps = OPS.filter(
      (o) => o.section === section && (counts[o.key] > 0 || allMatching[o.key])
    );
    if (activeOps.length === 0) return;

    // Validate all configs before creating anything.
    for (const op of activeOps) {
      const { error: cfgError } = opConfig(op.key);
      if (cfgError) {
        setError(cfgError);
        return;
      }
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      // Resolve "all matching filter" once if any op needs it.
      let matchingIds: string[] | null = null;
      if (activeOps.some((o) => allMatching[o.key])) {
        const res = await fetch(`/api/admin/workbench/item-ids?${filterQuery}`);
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Failed to resolve matching items");
          return;
        }
        matchingIds = data.itemIds as string[];
        if (data.capped) {
          setError(`Filter matches ${data.total} items — capped at ${matchingIds.length}. Narrow the filter.`);
          return;
        }
      }

      const created: string[] = [];
      for (const op of activeOps) {
        const ids = allMatching[op.key]
          ? matchingIds!
          : sel[op.key];
        if (ids.length === 0) continue;
        const { config, modelOverride } = opConfig(op.key);
        const res = await fetch("/api/admin/enhance/batches", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            op: op.key,
            label: `Workbench: ${op.label}`,
            config,
            ...(modelOverride ? { modelOverride } : {}),
            selection: { itemIds: ids },
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(`${op.label}: ${data.error ?? `failed (${res.status})`}`);
          return;
        }
        created.push(`${op.label} (${data.matched})`);
        // Clear this op's selection now that its batch exists.
        setSel((prev) => ({ ...prev, [op.key]: [] }));
        setAllMatching((prev) => ({ ...prev, [op.key]: false }));
      }

      if (created.length > 0) {
        fetch("/api/cron/enhance").catch(() => {}); // kick the queue
        setNotice(`Created: ${created.join(" · ")} — running now.`);
      }
      setModalSection(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  const estimateFor = (section: "wiggle" | "substantive") =>
    OPS.filter((o) => o.section === section).reduce((s, o) => {
      const n = allMatching[o.key] ? matchingTotal : counts[o.key];
      return s + n * o.estPerJob;
    }, 0);

  const inputCls = "border border-brand-ink/20 rounded px-2 py-1 text-sm bg-white";
  const labelCls = "block text-xs uppercase tracking-wider text-brand-ink/50 mb-1";

  const checkboxCol = (op: OpDef) => (
    <th key={op.key} className="pb-1 px-1 text-center font-normal">
      <label className="flex flex-col items-center gap-0.5 cursor-pointer" title={`${op.label} — select all on page`}>
        <span className="text-[10px] uppercase tracking-wider text-brand-ink/40">{op.short}</span>
        <input
          type="checkbox"
          checked={pageIds.length > 0 && pageIds.every((id) => sel[op.key].includes(id))}
          onChange={() => togglePage(op.key)}
        />
      </label>
    </th>
  );

  return (
    <div>
      {/* ── Action toolbar ── */}
      <div className="bg-white border border-brand-ink/15 rounded-lg p-3 mb-4 flex items-center gap-4 flex-wrap sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-2 text-sm border-r border-brand-ink/10 pr-4">
          <span className="text-xs uppercase tracking-wider text-brand-ink/50">
            Express
          </span>
          <input
            className="border border-brand-ink/20 rounded px-2 py-1 text-sm w-16"
            value={expressN}
            onChange={(e) => setExpressN(e.target.value)}
            inputMode="numeric"
            title="How many items"
          />
          <select
            className="border border-brand-ink/20 rounded px-2 py-1 text-sm"
            value={expressOp}
            onChange={(e) => setExpressOp(e.target.value as OpKey)}
          >
            {OPS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            onClick={expressSelect}
            disabled={busy}
            className="bg-white border border-brand-ink/30 hover:border-brand-ink rounded px-3 py-1 text-sm disabled:opacity-50"
            title="Select the N most-neglected items matching the current filter: never actioned first, then longest idle, oldest listings first"
          >
            Select
          </button>
        </div>
        <div className="text-sm">
          <span className="text-xs uppercase tracking-wider text-brand-ink/50 mr-2">Wiggles</span>
          {OPS.filter((o) => o.section === "wiggle").map((o) => (
            <span key={o.key} className="mr-3 text-brand-ink/70">
              {o.short}: <span className="font-medium">{counts[o.key]}</span>
            </span>
          ))}
          <button
            onClick={() => setModalSection("wiggle")}
            disabled={busy || sectionCount("wiggle") === 0}
            className="bg-brand-ink text-brand-paper hover:bg-brand-ink/85 rounded px-3 py-1 text-sm disabled:opacity-40"
          >
            Apply wiggles…
          </button>
        </div>
        <div className="text-sm">
          <span className="text-xs uppercase tracking-wider text-brand-ink/50 mr-2">Substantive</span>
          {OPS.filter((o) => o.section === "substantive").map((o) => (
            <span key={o.key} className="mr-3 text-brand-ink/70">
              {o.short}: <span className="font-medium">{counts[o.key]}</span>
            </span>
          ))}
          <button
            onClick={() => setModalSection("substantive")}
            disabled={busy || sectionCount("substantive") === 0}
            className="bg-brand-ink text-brand-paper hover:bg-brand-ink/85 rounded px-3 py-1 text-sm disabled:opacity-40"
          >
            Apply substantive…
          </button>
        </div>
        {notice && <span className="text-xs text-brand-ink/70">{notice}</span>}
        {error && !modalSection && <span className="text-xs text-red-700">{error}</span>}
      </div>

      {/* ── Grid ── */}
      <div className="bg-white border border-brand-ink/15 rounded-lg p-5 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-brand-ink/30">
              <th colSpan={5}></th>
              <th colSpan={2} className="text-center border-l border-brand-ink/10">Item wiggles</th>
              <th colSpan={4} className="text-center border-l border-brand-ink/10">Substantive changes</th>
              <th colSpan={2} className="border-l border-brand-ink/10"></th>
            </tr>
            <tr className="text-left text-xs uppercase tracking-wider text-brand-ink/40">
              <th className="pb-1 pr-3"></th>
              <th className="pb-1 pr-4">Title</th>
              <th className="pb-1 pr-4">SKU</th>
              <th className="pb-1 pr-4">Class</th>
              <th className="pb-1 pr-4 text-right">Price</th>
              {OPS.filter((o) => o.section === "wiggle").map(checkboxCol)}
              {OPS.filter((o) => o.section === "substantive").map(checkboxCol)}
              <th className="pb-1 px-3 whitespace-nowrap">Last wiggle</th>
              <th className="pb-1 whitespace-nowrap">Last subst.</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.itemId} className="border-t border-brand-ink/5">
                <td className="py-1.5 pr-3">
                  {r.thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.thumb} alt="" className="w-12 h-12 object-cover rounded border border-brand-ink/10" loading="lazy" />
                  ) : (
                    <div className="w-12 h-12 rounded bg-brand-ink/5" />
                  )}
                </td>
                <td className="py-1.5 pr-4 max-w-sm">
                  <a
                    href={`https://www.ebay.com/itm/${r.itemId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:underline underline-offset-2 decoration-brand-yellow decoration-2"
                  >
                    <span className="block truncate">{r.title}</span>
                  </a>
                </td>
                <td className="py-1.5 pr-4 font-mono text-xs whitespace-nowrap">{r.sku ?? "—"}</td>
                <td className="py-1.5 pr-4 whitespace-nowrap">
                  <span
                    className={`text-xs px-2 py-0.5 rounded ${
                      r.skuClass === "irregular" || r.skuClass === "none"
                        ? "bg-red-100 text-red-800"
                        : "bg-brand-ink/5 text-brand-ink/70"
                    }`}
                  >
                    {r.skuClassLabel}
                  </span>
                </td>
                <td className="py-1.5 pr-4 text-right whitespace-nowrap">
                  {r.price ? `$${Number(r.price).toFixed(2)}` : "—"}
                </td>
                {OPS.map((o) => (
                  <td key={o.key} className={`py-1.5 px-1 text-center ${o.key === "price_adjust" || o.key === "item_specifics" ? "border-l border-brand-ink/10" : ""}`}>
                    <input
                      type="checkbox"
                      checked={sel[o.key].includes(r.itemId)}
                      onChange={() => toggle(o.key, r.itemId)}
                    />
                  </td>
                ))}
                <td className="py-1.5 px-3 whitespace-nowrap text-xs border-l border-brand-ink/10">
                  {r.lastWiggle ?? <span className="text-brand-ink/40">never</span>}
                </td>
                <td className="py-1.5 whitespace-nowrap text-xs">
                  {r.lastSubstantive ?? <span className="text-brand-ink/40">never</span>}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={13} className="py-8 text-center text-sm text-brand-ink/50">
                  Nothing matches these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Apply modal ── */}
      {modalSection && (
        <div className="fixed inset-0 bg-brand-ink/40 z-20 flex items-start justify-center overflow-y-auto p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full p-6 my-8">
            <div className="flex items-baseline justify-between mb-4">
              <h2 className="font-medium text-lg">
                Apply {modalSection === "wiggle" ? "item wiggles" : "substantive changes"}
              </h2>
              <button onClick={() => setModalSection(null)} className="text-sm text-brand-ink/60 hover:text-brand-ink">
                Close
              </button>
            </div>

            {OPS.filter((o) => o.section === modalSection).map((op) => {
              const n = counts[op.key];
              const active = n > 0 || allMatching[op.key];
              return (
                <div key={op.key} className={`border rounded-lg p-4 mb-3 ${active ? "border-brand-yellow bg-brand-yellow/5" : "border-brand-ink/10 opacity-60"}`}>
                  <div className="flex items-baseline justify-between mb-2 flex-wrap gap-2">
                    <p className="font-medium">
                      {op.label}{" "}
                      <span className="text-sm text-brand-ink/50 font-normal">
                        — {allMatching[op.key] ? `ALL ${matchingTotal} matching filter` : `${n} checked`}
                        {op.estPerJob > 0 &&
                          ` · ~$${((allMatching[op.key] ? matchingTotal : n) * op.estPerJob).toFixed(2)}`}
                      </span>
                    </p>
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={allMatching[op.key]}
                        onChange={(e) =>
                          setAllMatching((prev) => ({ ...prev, [op.key]: e.target.checked }))
                        }
                      />
                      Apply to all {matchingTotal} matching current filter
                    </label>
                  </div>

                  {op.key === "price_adjust" && (
                    <div className="grid gap-2 sm:grid-cols-4">
                      <div>
                        <label className={labelCls}>Adjustment</label>
                        <select className={`${inputCls} w-full`} value={priceMode} onChange={(e) => setPriceMode(e.target.value as typeof priceMode)}>
                          <option value="percent">Percent (%)</option>
                          <option value="flat">Flat ($)</option>
                        </select>
                      </div>
                      <div>
                        <label className={labelCls}>Delta</label>
                        <input className={`${inputCls} w-full`} value={priceDelta} onChange={(e) => setPriceDelta(e.target.value)} placeholder={priceMode === "percent" ? "5" : "1.00"} inputMode="decimal" />
                      </div>
                      <div>
                        <label className={labelCls}>Floor $</label>
                        <input className={`${inputCls} w-full`} value={priceFloor} onChange={(e) => setPriceFloor(e.target.value)} placeholder="0.99" inputMode="decimal" />
                      </div>
                      <label className="flex items-end gap-2 text-sm pb-1">
                        <input type="checkbox" checked={priceRound87} onChange={(e) => setPriceRound87(e.target.checked)} />
                        Round to .87
                      </label>
                    </div>
                  )}

                  {op.key === "sku_rename" && (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div>
                        <label className={labelCls}>Set SKU to</label>
                        <input className={`${inputCls} w-full`} value={skuSetTo} onChange={(e) => setSkuSetTo(e.target.value)} placeholder="NA320" />
                      </div>
                      <p className="text-xs text-brand-ink/50 self-end pb-1">
                        Every checked item gets exactly this SKU.
                      </p>
                    </div>
                  )}

                  {op.key === "item_specifics" && (
                    <div className="grid gap-2 sm:grid-cols-3">
                      <div>
                        <label className={labelCls}>Specifics</label>
                        <input className={`${inputCls} w-full`} value={specList} onChange={(e) => setSpecList(e.target.value)} />
                      </div>
                      <div>
                        <label className={labelCls}>Model</label>
                        <select className={`${inputCls} w-full`} value={specModel} onChange={(e) => setSpecModel(e.target.value)}>
                          <option value="gemini:gemini-2.5-flash">Gemini 2.5 Flash</option>
                          <option value="gemini:gemini-2.5-flash-lite">Flash-Lite (budget)</option>
                          <option value="openai:gpt-4o-mini">GPT-4o-mini</option>
                        </select>
                      </div>
                      <label className="flex items-end gap-2 text-sm pb-1">
                        <input type="checkbox" checked={specPhoto} onChange={(e) => setSpecPhoto(e.target.checked)} />
                        Use photo
                      </label>
                    </div>
                  )}

                  {(op.key === "title_remix" || op.key === "description_remix") && (
                    <div className="grid gap-2 sm:grid-cols-3">
                      <div>
                        <label className={labelCls}>Expert guide</label>
                        <select
                          className={`${inputCls} w-full`}
                          value={op.key === "title_remix" ? titleGuide : descGuide}
                          onChange={(e) =>
                            op.key === "title_remix"
                              ? setTitleGuide(e.target.value)
                              : setDescGuide(e.target.value)
                          }
                        >
                          <option value="">Pick a guide…</option>
                          {guides.map((g) => (
                            <option key={g.id} value={g.id}>{g.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className={labelCls}>Model</label>
                        {op.key === "title_remix" ? (
                          <select className={`${inputCls} w-full`} value={titleModel} onChange={(e) => setTitleModel(e.target.value)}>
                            <option value="anthropic:claude-haiku-4-5-20251001">Haiku 4.5</option>
                            <option value="gemini:gemini-2.5-flash">Gemini 2.5 Flash</option>
                          </select>
                        ) : (
                          <select className={`${inputCls} w-full`} value={descModel} onChange={(e) => setDescModel(e.target.value)}>
                            <option value="anthropic:claude-sonnet-5">Sonnet 5</option>
                            <option value="openai:gpt-4o">GPT-4o</option>
                            <option value="gemini:gemini-2.5-pro">Gemini 2.5 Pro</option>
                          </select>
                        )}
                      </div>
                      <div>
                        <label className={labelCls}>Instructions (optional)</label>
                        <input className={`${inputCls} w-full`} value={remixInstructions} onChange={(e) => setRemixInstructions(e.target.value)} />
                      </div>
                    </div>
                  )}

                  {op.key === "price_research" && (
                    <div className="grid gap-2 sm:grid-cols-3">
                      <div>
                        <label className={labelCls}>Anchor</label>
                        <select className={`${inputCls} w-full`} value={aprAnchor} onChange={(e) => setAprAnchor(e.target.value as typeof aprAnchor)}>
                          <option value="recommended">Recommended (p75)</option>
                          <option value="median">Median</option>
                        </select>
                      </div>
                      <div>
                        <label className={labelCls}>Max change %</label>
                        <input className={`${inputCls} w-full`} value={aprMaxChange} onChange={(e) => setAprMaxChange(e.target.value)} placeholder="50" inputMode="decimal" />
                      </div>
                      <p className="text-xs text-brand-ink/50 self-end pb-1">
                        Keep the APR PC awake. Rounds to .87.
                      </p>
                    </div>
                  )}
                </div>
              );
            })}

            {error && (
              <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2 mb-3">
                {error}
              </p>
            )}

            <div className="flex items-center gap-3">
              <button
                onClick={() => applySection(modalSection)}
                disabled={busy || sectionCount(modalSection) === 0}
                className="bg-brand-ink text-brand-paper hover:bg-brand-ink/85 rounded px-4 py-2 text-sm disabled:opacity-40"
              >
                {busy
                  ? "Creating batches…"
                  : `Create ${sectionCount(modalSection)} batch${sectionCount(modalSection) === 1 ? "" : "es"} · est. $${estimateFor(modalSection).toFixed(2)}`}
              </button>
              <p className="text-xs text-brand-ink/50">
                Batches appear on the{" "}
                <Link href="/admin/ebay/enhance" className="underline">
                  Expert Enhance dashboard
                </Link>{" "}
                and start running immediately.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
