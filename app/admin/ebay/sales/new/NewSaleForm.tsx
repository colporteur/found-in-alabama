"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { CategoryDTO } from "./page";

type SaleType =
  | "MARKDOWN_CATEGORY"
  | "MARKDOWN_SKU"
  | "ORDER_DISCOUNT"
  | "CODELESS_VOUCHER";

const SALE_TYPE_LABELS: Record<SaleType, { label: string; desc: string; ready: boolean }> = {
  MARKDOWN_CATEGORY: {
    label: "% off store category",
    desc: "Markdown one or more store categories.",
    ready: true,
  },
  MARKDOWN_SKU: {
    label: "% off SKU list",
    desc: "Markdown specific SKUs.",
    ready: false,
  },
  ORDER_DISCOUNT: {
    label: "Order discount",
    desc: "Spend X, save Y.",
    ready: false,
  },
  CODELESS_VOUCHER: {
    label: "Codeless voucher",
    desc: "Auto-applied % or $ off.",
    ready: false,
  },
};

interface CreateResult {
  ok: boolean;
  saleId?: string;
  ebayPromotionId?: string;
  error?: string;
  debug?: {
    sentBody?: unknown;
    sentToUrl?: string;
    ebayResponseBody?: string;
  };
}

function defaultStartIso(): string {
  // Tomorrow 9am local
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return toLocalInputValue(d);
}

function defaultEndIso(): string {
  // 8 days from now 9am local
  const d = new Date();
  d.setDate(d.getDate() + 8);
  d.setHours(9, 0, 0, 0);
  return toLocalInputValue(d);
}

/** datetime-local input expects "YYYY-MM-DDTHH:mm" in the user's local TZ. */
function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

export default function NewSaleForm({ categories }: { categories: CategoryDTO[] }) {
  const router = useRouter();
  const [saleType, setSaleType] = useState<SaleType>("MARKDOWN_CATEGORY");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [discountPercent, setDiscountPercent] = useState<number>(15);
  const [selectedCats, setSelectedCats] = useState<Set<string>>(new Set());
  const [startsAt, setStartsAt] = useState(defaultStartIso());
  const [endsAt, setEndsAt] = useState(defaultEndIso());
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<CreateResult | null>(null);
  const [search, setSearch] = useState("");

  const sortedCats = useMemo(
    () =>
      [...categories].sort((a, b) => {
        if (a.isAlabama !== b.isAlabama) return a.isAlabama ? -1 : 1;
        return a.name.localeCompare(b.name);
      }),
    [categories]
  );

  const filteredCats = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sortedCats;
    return sortedCats.filter((c) => c.name.toLowerCase().includes(q));
  }, [sortedCats, search]);

  function toggleCat(id: string) {
    setSelectedCats((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/ebay/sales/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          saleType,
          name,
          description: description || undefined,
          discountPercent,
          categoryIds: Array.from(selectedCats),
          startsAt: new Date(startsAt).toISOString(),
          endsAt: new Date(endsAt).toISOString(),
        }),
      });
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("application/json")) {
        const text = await res.text();
        setResult({ ok: false, error: `HTTP ${res.status}: ${text.slice(0, 300)}` });
        return;
      }
      const json = (await res.json()) as CreateResult;
      setResult(json);
      if (json.ok) {
        // Bounce to the sales list after a brief moment so the user sees
        // the success message.
        setTimeout(() => router.push("/admin/ebay/sales"), 1200);
      }
    } catch (err) {
      setResult({ ok: false, error: (err as Error).message });
    } finally {
      setSubmitting(false);
    }
  }

  const valid =
    saleType === "MARKDOWN_CATEGORY" &&
    name.trim().length > 0 &&
    selectedCats.size > 0 &&
    discountPercent > 0 &&
    discountPercent <= 80 &&
    startsAt &&
    endsAt &&
    new Date(endsAt) > new Date(startsAt);

  return (
    <form onSubmit={submit} className="space-y-6">
      {/* Sale type */}
      <div className="bg-white border border-brand-ink/15 rounded-lg p-5">
        <h2 className="font-medium text-lg mb-3">Sale type</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {(Object.keys(SALE_TYPE_LABELS) as SaleType[]).map((t) => {
            const cfg = SALE_TYPE_LABELS[t];
            const active = saleType === t;
            return (
              <label
                key={t}
                className={`flex flex-col rounded-lg border p-3 text-sm cursor-pointer transition-colors ${
                  active
                    ? "border-brand-yellow bg-brand-yellow/10"
                    : cfg.ready
                    ? "border-brand-ink/15 hover:border-brand-ink/30"
                    : "border-brand-ink/10 opacity-60 cursor-not-allowed"
                }`}
              >
                <input
                  type="radio"
                  name="saleType"
                  value={t}
                  checked={active}
                  disabled={!cfg.ready}
                  onChange={() => setSaleType(t)}
                  className="sr-only"
                />
                <span className="font-medium">{cfg.label}</span>
                <span className="text-brand-ink/60 text-xs mt-0.5">
                  {cfg.desc}
                </span>
                {!cfg.ready && (
                  <span className="text-xs text-brand-ink/50 italic mt-1">
                    Coming next round
                  </span>
                )}
              </label>
            );
          })}
        </div>
      </div>

      {/* Common fields */}
      <div className="bg-white border border-brand-ink/15 rounded-lg p-5 space-y-4">
        <h2 className="font-medium text-lg">Details</h2>
        <Field label="Name (shown to buyers)">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={90}
            required
            placeholder="e.g. Spring Pokémon Sale"
            className="w-full text-sm border border-brand-ink/15 rounded px-3 py-2 bg-brand-paper focus:outline-none focus:border-brand-yellow"
          />
        </Field>
        <Field label="Description (optional)">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={500}
            rows={2}
            placeholder="Short blurb shown next to the sale on eBay."
            className="w-full text-sm border border-brand-ink/15 rounded px-3 py-2 bg-brand-paper focus:outline-none focus:border-brand-yellow"
          />
        </Field>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Starts at (your local time)">
            <input
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              required
              className="w-full text-sm border border-brand-ink/15 rounded px-3 py-2 bg-brand-paper focus:outline-none focus:border-brand-yellow"
            />
          </Field>
          <Field label="Ends at">
            <input
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              required
              className="w-full text-sm border border-brand-ink/15 rounded px-3 py-2 bg-brand-paper focus:outline-none focus:border-brand-yellow"
            />
          </Field>
        </div>
        <Field label={`Discount: ${discountPercent}% off`}>
          <input
            type="range"
            min={5}
            max={80}
            step={5}
            value={discountPercent}
            onChange={(e) => setDiscountPercent(Number(e.target.value))}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-brand-ink/40 mt-1">
            <span>5%</span>
            <span>80%</span>
          </div>
        </Field>
      </div>

      {/* Categories */}
      <div className="bg-white border border-brand-ink/15 rounded-lg p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3 mb-3">
          <h2 className="font-medium text-lg">
            Categories ({selectedCats.size} selected)
          </h2>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search categories…"
            className="text-sm border border-brand-ink/15 rounded px-3 py-1.5 bg-brand-paper focus:outline-none focus:border-brand-yellow w-full sm:w-64"
          />
        </div>
        <p className="text-xs text-brand-ink/60 mb-3">
          Alabama-flagged categories appear first. You can pick more than one.
          Items must be assigned to a selected category for the sale to apply
          to them — listings still in the &ldquo;Other&rdquo; bucket are not
          eligible.
        </p>
        <div className="max-h-72 overflow-y-auto border border-brand-ink/10 rounded">
          <ul className="divide-y divide-brand-ink/5">
            {filteredCats.map((c) => (
              <li key={c.id} className="px-3 py-2 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  id={`cat-${c.id}`}
                  checked={selectedCats.has(c.id)}
                  onChange={() => toggleCat(c.id)}
                  className="h-4 w-4 accent-brand-yellow"
                />
                <label
                  htmlFor={`cat-${c.id}`}
                  className="flex-1 cursor-pointer flex items-center gap-2"
                >
                  {c.isAlabama && (
                    <span className="text-xs uppercase tracking-wider px-1.5 py-0.5 rounded bg-brand-yellow/30 text-brand-ink">
                      AL
                    </span>
                  )}
                  <span>{c.name}</span>
                  <span className="text-xs text-brand-ink/40 ml-auto">
                    #{c.id}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Submit */}
      <div className="bg-white border border-brand-ink/15 rounded-lg p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-brand-ink/70">
            {valid
              ? `Will create a ${discountPercent}% off sale on ${selectedCats.size} categor${selectedCats.size === 1 ? "y" : "ies"}.`
              : "Fill the form to enable submission."}
          </p>
          <button
            type="submit"
            disabled={!valid || submitting}
            className="bg-brand-ink text-brand-paper text-sm px-4 py-2 rounded hover:bg-brand-ink/90 disabled:opacity-40"
          >
            {submitting ? "Creating…" : "Create sale on eBay"}
          </button>
        </div>

        {result && result.ok && (
          <div className="mt-3 border-l-4 border-brand-yellow bg-brand-yellow/10 p-3 text-sm">
            ✅ Sale scheduled.
            {result.ebayPromotionId && (
              <span className="text-xs text-brand-ink/60 ml-2">
                eBay promotion ID: <code>{result.ebayPromotionId}</code>
              </span>
            )}
          </div>
        )}
        {result && !result.ok && (
          <div className="mt-3 border-l-4 border-red-500 bg-red-50 p-3 text-sm break-words space-y-2">
            <p>❌ {result.error}</p>
            {result.debug && (
              <details className="text-xs">
                <summary className="cursor-pointer text-brand-ink/60 hover:text-brand-ink">
                  Debug payload (EBAY_DEBUG enabled)
                </summary>
                <div className="mt-2 space-y-2">
                  {result.debug.sentToUrl && (
                    <p>
                      <span className="text-brand-ink/60">URL:</span>{" "}
                      <code>{result.debug.sentToUrl}</code>
                    </p>
                  )}
                  {result.debug.sentBody !== undefined && (
                    <div>
                      <p className="text-brand-ink/60 mb-1">Request body:</p>
                      <pre className="bg-white/60 border border-brand-ink/10 rounded p-2 overflow-x-auto max-h-72">
                        {JSON.stringify(result.debug.sentBody, null, 2)}
                      </pre>
                    </div>
                  )}
                  {result.debug.ebayResponseBody && (
                    <div>
                      <p className="text-brand-ink/60 mb-1">eBay response:</p>
                      <pre className="bg-white/60 border border-brand-ink/10 rounded p-2 overflow-x-auto max-h-72">
                        {result.debug.ebayResponseBody}
                      </pre>
                    </div>
                  )}
                </div>
              </details>
            )}
          </div>
        )}
      </div>
    </form>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="text-brand-ink/60 text-xs uppercase tracking-wider mb-1 block">
        {label}
      </span>
      {children}
    </label>
  );
}
