"use client";

// Batch creation form for the Expert Enhance portal (Phase 1 ops:
// price_adjust + sku_rename). Preview-first flow: the Create button
// only unlocks after a dry-run preview, which doubles as the
// "this batch will cost ~$X, proceed?" gate (decision #3) — trivially
// $0.00 for Phase 1 ops, but the gate pattern is in place for the AI
// ops in Phases 2-4.

import { useState } from "react";
import { useRouter } from "next/navigation";

type Category = { categoryId: string; name: string };

type Preview = {
  matched: number;
  estimatedCostUsd: number;
  sample: Array<{
    itemId: string;
    sku: string | null;
    title: string;
    price: string | null;
  }>;
};

export default function NewBatchForm({ categories }: { categories: Category[] }) {
  const router = useRouter();
  const [op, setOp] = useState<"price_adjust" | "sku_rename">("price_adjust");
  const [label, setLabel] = useState("");

  // price_adjust config
  const [mode, setMode] = useState<"percent" | "flat">("percent");
  const [delta, setDelta] = useState("");
  const [floor, setFloor] = useState("");
  const [round87, setRound87] = useState(true);

  // sku_rename config
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [skuMode, setSkuMode] = useState<"exact" | "prefix" | "contains">("exact");

  // selection
  const [skuFilter, setSkuFilter] = useState("");
  const [skuFilterMode, setSkuFilterMode] = useState<"contains" | "prefix" | "exact">("contains");
  const [categoryId, setCategoryId] = useState("");
  const [titleContains, setTitleContains] = useState("");
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");

  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<"preview" | "create" | null>(null);
  const [error, setError] = useState<string | null>(null);

  function buildBody(dryRun: boolean) {
    const config =
      op === "price_adjust"
        ? {
            mode,
            delta: Number(delta),
            ...(floor ? { floor: Number(floor) } : {}),
            round87,
          }
        : { find, replace, mode: skuMode };

    const selection: Record<string, unknown> = {};
    if (skuFilter) {
      if (skuFilterMode === "exact") selection.skuExact = skuFilter;
      else if (skuFilterMode === "prefix") selection.skuPrefix = skuFilter;
      else selection.skuContains = skuFilter;
    }
    if (categoryId) selection.storeCategoryId = categoryId;
    if (titleContains) selection.titleContains = titleContains;
    if (priceMin) selection.priceMin = Number(priceMin);
    if (priceMax) selection.priceMax = Number(priceMax);

    return { op, label, config, selection, dryRun };
  }

  function validate(): string | null {
    if (op === "price_adjust") {
      if (!delta || !Number.isFinite(Number(delta)) || Number(delta) === 0) {
        return "Enter a non-zero delta.";
      }
    } else {
      if (!find) return "Enter the SKU text to find.";
      if (!replace && skuMode === "exact") return "Enter the replacement SKU.";
    }
    return null;
  }

  async function submit(dryRun: boolean) {
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setError(null);
    setBusy(dryRun ? "preview" : "create");
    try {
      const res = await fetch("/api/admin/enhance/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildBody(dryRun)),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      if (dryRun) {
        setPreview(data as Preview);
      } else {
        setPreview(null);
        setLabel("");
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(null);
    }
  }

  const inputCls =
    "border border-brand-ink/20 rounded px-2 py-1.5 text-sm bg-white w-full";
  const labelCls = "block text-xs uppercase tracking-wider text-brand-ink/50 mb-1";

  return (
    <div className="bg-white border border-brand-ink/15 rounded-lg p-5 mb-10">
      <p className="text-xs uppercase tracking-wider text-brand-ink/50 mb-4">
        New batch
      </p>

      {/* Op + label */}
      <div className="grid gap-4 sm:grid-cols-2 mb-4">
        <div>
          <label className={labelCls}>Operation</label>
          <select
            className={inputCls}
            value={op}
            onChange={(e) => {
              setOp(e.target.value as typeof op);
              setPreview(null);
            }}
          >
            <option value="price_adjust">Price bump / discount</option>
            <option value="sku_rename">SKU rename (bin consolidation)</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>Label (optional)</label>
          <input
            className={inputCls}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder='e.g. "July 5% bump on postcards"'
          />
        </div>
      </div>

      {/* Op config */}
      {op === "price_adjust" ? (
        <div className="grid gap-4 sm:grid-cols-4 mb-4">
          <div>
            <label className={labelCls}>Adjustment</label>
            <select
              className={inputCls}
              value={mode}
              onChange={(e) => setMode(e.target.value as typeof mode)}
            >
              <option value="percent">Percent (%)</option>
              <option value="flat">Flat ($)</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>
              Delta ({mode === "percent" ? "%" : "$"}, neg. = discount)
            </label>
            <input
              className={inputCls}
              value={delta}
              onChange={(e) => setDelta(e.target.value)}
              placeholder={mode === "percent" ? "5" : "1.00"}
              inputMode="decimal"
            />
          </div>
          <div>
            <label className={labelCls}>Floor $ (default 0.99)</label>
            <input
              className={inputCls}
              value={floor}
              onChange={(e) => setFloor(e.target.value)}
              placeholder="0.99"
              inputMode="decimal"
            />
          </div>
          <div className="flex items-end pb-1.5">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={round87}
                onChange={(e) => setRound87(e.target.checked)}
              />
              Round to .87
            </label>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-3 mb-4">
          <div>
            <label className={labelCls}>Find</label>
            <input
              className={inputCls}
              value={find}
              onChange={(e) => setFind(e.target.value)}
              placeholder="NA311"
            />
          </div>
          <div>
            <label className={labelCls}>Replace with</label>
            <input
              className={inputCls}
              value={replace}
              onChange={(e) => setReplace(e.target.value)}
              placeholder="NA312"
            />
          </div>
          <div>
            <label className={labelCls}>Match mode</label>
            <select
              className={inputCls}
              value={skuMode}
              onChange={(e) => setSkuMode(e.target.value as typeof skuMode)}
            >
              <option value="exact">Exact SKU</option>
              <option value="prefix">SKU prefix</option>
              <option value="contains">SKU contains</option>
            </select>
          </div>
        </div>
      )}

      {/* Selection */}
      <p className="text-xs uppercase tracking-wider text-brand-ink/50 mb-2 mt-6">
        Which listings{" "}
        {op === "sku_rename" && (
          <span className="normal-case tracking-normal text-brand-ink/40">
            (leave blank to target the Find value above)
          </span>
        )}
      </p>
      <div className="grid gap-4 sm:grid-cols-3 mb-4">
        <div className="sm:col-span-1">
          <label className={labelCls}>SKU filter</label>
          <div className="flex gap-2">
            <select
              className="border border-brand-ink/20 rounded px-2 py-1.5 text-sm bg-white"
              value={skuFilterMode}
              onChange={(e) => setSkuFilterMode(e.target.value as typeof skuFilterMode)}
            >
              <option value="contains">contains</option>
              <option value="prefix">prefix</option>
              <option value="exact">exact</option>
            </select>
            <input
              className={inputCls}
              value={skuFilter}
              onChange={(e) => setSkuFilter(e.target.value)}
              placeholder="NA3"
            />
          </div>
        </div>
        <div>
          <label className={labelCls}>Store category</label>
          <select
            className={inputCls}
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">Any</option>
            {categories.map((c) => (
              <option key={c.categoryId} value={c.categoryId}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Title contains</label>
          <input
            className={inputCls}
            value={titleContains}
            onChange={(e) => setTitleContains(e.target.value)}
            placeholder="postcard"
          />
        </div>
        <div>
          <label className={labelCls}>Price min $</label>
          <input
            className={inputCls}
            value={priceMin}
            onChange={(e) => setPriceMin(e.target.value)}
            inputMode="decimal"
          />
        </div>
        <div>
          <label className={labelCls}>Price max $</label>
          <input
            className={inputCls}
            value={priceMax}
            onChange={(e) => setPriceMax(e.target.value)}
            inputMode="decimal"
          />
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2 mb-4">
          {error}
        </p>
      )}

      {preview && (
        <div className="border border-brand-yellow bg-brand-yellow/10 rounded p-4 mb-4">
          <p className="text-sm font-medium mb-2">
            {preview.matched} listing{preview.matched === 1 ? "" : "s"} matched ·
            estimated cost ${preview.estimatedCostUsd.toFixed(2)}
          </p>
          {preview.sample.length > 0 && (
            <ul className="text-xs text-brand-ink/70 space-y-1">
              {preview.sample.map((s) => (
                <li key={s.itemId} className="truncate">
                  <span className="font-mono">{s.sku ?? "—"}</span> · ${s.price ?? "?"} ·{" "}
                  {s.title}
                </li>
              ))}
              {preview.matched > preview.sample.length && (
                <li className="text-brand-ink/40">
                  …and {preview.matched - preview.sample.length} more
                </li>
              )}
            </ul>
          )}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={() => submit(true)}
          disabled={busy !== null}
          className="bg-white border border-brand-ink/30 hover:border-brand-ink rounded px-4 py-2 text-sm disabled:opacity-50"
        >
          {busy === "preview" ? "Previewing…" : "Preview"}
        </button>
        <button
          onClick={() => submit(false)}
          disabled={busy !== null || !preview || preview.matched === 0}
          className="bg-brand-ink text-brand-paper hover:bg-brand-ink/85 rounded px-4 py-2 text-sm disabled:opacity-40"
          title={!preview ? "Preview first" : undefined}
        >
          {busy === "create"
            ? "Creating…"
            : preview
            ? `Create batch (${preview.matched})`
            : "Create batch"}
        </button>
        <p className="text-xs text-brand-ink/50">
          Jobs run in the background within ~5 minutes (or use &ldquo;Run queue
          now&rdquo;).
        </p>
      </div>
    </div>
  );
}
