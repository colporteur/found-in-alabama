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
type GuideOption = { id: string; name: string };

type Preview = {
  matched: number;
  estimatedCostUsd: number;
  sample: Array<{
    itemId: string;
    sku: string | null;
    title: string;
    price: string | null;
    after: string | null;
  }>;
};

type Op =
  | "price_adjust"
  | "sku_rename"
  | "item_specifics"
  | "title_remix"
  | "description_remix"
  | "price_research";

export default function NewBatchForm({
  categories,
  guides,
}: {
  categories: Category[];
  guides: GuideOption[];
}) {
  const router = useRouter();
  const [op, setOp] = useState<Op>("price_adjust");
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

  // item_specifics config
  const [specificsList, setSpecificsList] = useState(
    "Brand, Color, Size, Material, Style, Type"
  );
  const [specificsModel, setSpecificsModel] = useState("gemini:gemini-2.5-flash");
  const [usePhoto, setUsePhoto] = useState(true);

  // remix config (title_remix + description_remix)
  const [guideId, setGuideId] = useState("");
  const [remixInstructions, setRemixInstructions] = useState("");
  const [titleModel, setTitleModel] = useState("anthropic:claude-haiku-4-5-20251001");
  const [descModel, setDescModel] = useState("anthropic:claude-sonnet-5");

  // price_research config
  const [aprAnchor, setAprAnchor] = useState<"recommended" | "median">("recommended");
  const [aprFloor, setAprFloor] = useState("");
  const [aprRound87, setAprRound87] = useState(true);
  const [aprMaxChange, setAprMaxChange] = useState("");

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
        : op === "sku_rename"
        ? { find, replace, mode: skuMode }
        : op === "item_specifics"
        ? {
            specifics: specificsList
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
            usePhoto,
          }
        : op === "price_research"
        ? {
            anchor: aprAnchor,
            ...(aprFloor ? { floor: Number(aprFloor) } : {}),
            round87: aprRound87,
            ...(aprMaxChange ? { maxChangePct: Number(aprMaxChange) } : {}),
          }
        : {
            guideId,
            ...(remixInstructions.trim()
              ? { instructions: remixInstructions.trim() }
              : {}),
          };

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

    const modelOverride =
      op === "item_specifics"
        ? specificsModel
        : op === "title_remix"
        ? titleModel
        : op === "description_remix"
        ? descModel
        : undefined;

    return {
      op,
      label,
      config,
      selection,
      dryRun,
      ...(modelOverride ? { modelOverride } : {}),
    };
  }

  function validate(): string | null {
    if (op === "price_adjust") {
      if (!delta || !Number.isFinite(Number(delta)) || Number(delta) === 0) {
        return "Enter a non-zero delta.";
      }
    } else if (op === "sku_rename") {
      if (!find) return "Enter the SKU text to find.";
      if (!replace && skuMode === "exact") return "Enter the replacement SKU.";
    } else if (op === "item_specifics") {
      if (!specificsList.trim()) return "Enter at least one specific to fill.";
    } else if (op === "title_remix" || op === "description_remix") {
      if (!guideId) return "Pick an expert guide.";
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
              setOp(e.target.value as Op);
              setPreview(null);
            }}
          >
            <option value="price_adjust">Price bump / discount</option>
            <option value="sku_rename">SKU rename (bin consolidation)</option>
            <option value="item_specifics">Item specifics fill (AI)</option>
            <option value="title_remix">Title remix — expert guide (AI)</option>
            <option value="description_remix">Description remix — expert guide (AI)</option>
            <option value="price_research">Price research reprice (APR)</option>
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
      ) : op === "sku_rename" ? (
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
      ) : op === "item_specifics" ? (
        <div className="grid gap-4 sm:grid-cols-3 mb-4">
          <div className="sm:col-span-1">
            <label className={labelCls}>Specifics to fill (comma-separated)</label>
            <input
              className={inputCls}
              value={specificsList}
              onChange={(e) => setSpecificsList(e.target.value)}
              placeholder="Brand, Color, Size, Material, Style, Type"
            />
            <p className="text-xs text-brand-ink/40 mt-1">
              Only EMPTY specifics get filled — existing values are never touched.
            </p>
          </div>
          <div>
            <label className={labelCls}>Model</label>
            <select
              className={inputCls}
              value={specificsModel}
              onChange={(e) => setSpecificsModel(e.target.value)}
            >
              <option value="gemini:gemini-2.5-flash">Gemini 2.5 Flash (default)</option>
              <option value="gemini:gemini-2.5-flash-lite">Gemini 2.5 Flash-Lite (budget)</option>
              <option value="openai:gpt-4o-mini">GPT-4o-mini</option>
            </select>
          </div>
          <div className="flex items-end pb-1.5">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={usePhoto}
                onChange={(e) => setUsePhoto(e.target.checked)}
              />
              Use listing photo (helps Color/Material)
            </label>
          </div>
        </div>
      ) : op === "price_research" ? (
        <div className="grid gap-4 sm:grid-cols-4 mb-4">
          <div>
            <label className={labelCls}>Anchor</label>
            <select
              className={inputCls}
              value={aprAnchor}
              onChange={(e) => setAprAnchor(e.target.value as typeof aprAnchor)}
            >
              <option value="recommended">Recommended (75th pctile)</option>
              <option value="median">Median</option>
            </select>
            <p className="text-xs text-brand-ink/40 mt-1">
              Runs through your local APR service — keep the PC awake.
              ~$0.03 and a few minutes per item.
            </p>
          </div>
          <div>
            <label className={labelCls}>Floor $ (default 0.99)</label>
            <input
              className={inputCls}
              value={aprFloor}
              onChange={(e) => setAprFloor(e.target.value)}
              placeholder="0.99"
              inputMode="decimal"
            />
          </div>
          <div>
            <label className={labelCls}>Max change % (blank = no cap)</label>
            <input
              className={inputCls}
              value={aprMaxChange}
              onChange={(e) => setAprMaxChange(e.target.value)}
              placeholder="50"
              inputMode="decimal"
            />
            <p className="text-xs text-brand-ink/40 mt-1">
              Bigger swings get skipped for manual review instead of applied.
            </p>
          </div>
          <div className="flex items-end pb-1.5">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={aprRound87}
                onChange={(e) => setAprRound87(e.target.checked)}
              />
              Round to .87
            </label>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-3 mb-4">
          <div>
            <label className={labelCls}>Expert guide</label>
            <select
              className={inputCls}
              value={guideId}
              onChange={(e) => setGuideId(e.target.value)}
            >
              <option value="">Pick a guide…</option>
              {guides.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-brand-ink/40 mt-1">
              Shipping/discount/return language is protected — the guide can
              never change it.
            </p>
          </div>
          <div>
            <label className={labelCls}>Model</label>
            {op === "title_remix" ? (
              <select
                className={inputCls}
                value={titleModel}
                onChange={(e) => setTitleModel(e.target.value)}
              >
                <option value="anthropic:claude-haiku-4-5-20251001">
                  Haiku 4.5 (default, cached guide)
                </option>
                <option value="gemini:gemini-2.5-flash">Gemini 2.5 Flash</option>
              </select>
            ) : (
              <select
                className={inputCls}
                value={descModel}
                onChange={(e) => setDescModel(e.target.value)}
              >
                <option value="anthropic:claude-sonnet-5">
                  Sonnet 5 (default, cached guide)
                </option>
                <option value="openai:gpt-4o">GPT-4o</option>
                <option value="gemini:gemini-2.5-pro">Gemini 2.5 Pro (budget)</option>
              </select>
            )}
          </div>
          <div>
            <label className={labelCls}>Extra instructions (optional)</label>
            <input
              className={inputCls}
              value={remixInstructions}
              onChange={(e) => setRemixInstructions(e.target.value)}
              placeholder='e.g. "emphasize Alabama connections"'
            />
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
          {op === "item_specifics" && (
            <p className="text-xs text-brand-ink/50 mb-2">
              Each sample item below was checked live on eBay. Only the
              &ldquo;will fill&rdquo; specifics get written — anything listed
              under &ldquo;keeps&rdquo; already has a value and is never
              touched. The values themselves are decided by the model at run
              time.
            </p>
          )}
          {preview.sample.length > 0 && (
            <ul className="text-xs text-brand-ink/70 space-y-1">
              {preview.sample.map((s) =>
                op === "item_specifics" ? (
                  <li key={s.itemId}>
                    <span className="truncate block">
                      <span className="font-mono">{s.sku ?? "—"}</span> · ${s.price ?? "?"} · {s.title}
                    </span>
                    <span className="block pl-5 font-medium text-brand-ink">
                      {s.after ?? "—"}
                    </span>
                  </li>
                ) : (
                  <li key={s.itemId} className="truncate">
                    <span className="font-mono">{s.sku ?? "—"}</span> ·{" "}
                    {op === "price_adjust" && s.after ? (
                      <span className="font-medium">
                        ${s.price ?? "?"} → {s.after}
                      </span>
                    ) : op === "sku_rename" && s.after ? (
                      <span className="font-medium font-mono">
                        {s.sku ?? "—"} → {s.after}
                      </span>
                    ) : (
                      <>${s.price ?? "?"}</>
                    )}{" "}
                    · {s.title}
                  </li>
                )
              )}
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
