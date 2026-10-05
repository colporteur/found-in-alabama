"use client";

// Editor for the foundinalabama.com direct-sale settings (Phase
// FIA-SHOP-1). Rate tables are edited as text — one "max-ounces price"
// pair per line — and a test box prices any weight with the settings as
// currently typed, before saving.

import { useMemo, useState } from "react";
import {
  quoteFiaShipping,
  tableToText,
  textToTable,
  type FiaShipSettings,
} from "@/lib/fia/shipping";

const fmt = (n: number) => `$${n.toFixed(2)}`;

function Field({
  label,
  hint,
  value,
  onChange,
  step = "0.01",
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  step?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="font-medium">{label}</span>
      {hint && <span className="block text-xs text-brand-ink/55">{hint}</span>}
      <input
        type="number"
        step={step}
        min={0}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-32 border border-brand-ink/20 rounded-md px-3 py-1.5 text-sm"
      />
    </label>
  );
}

export default function FiaShopEditor({
  initialPercent,
  initialSettings,
  defaults,
}: {
  initialPercent: number;
  initialSettings: FiaShipSettings;
  defaults: FiaShipSettings;
}) {
  const s0 = initialSettings;
  const [percent, setPercent] = useState(String(initialPercent));
  const [handling, setHandling] = useState(String(s0.handling));
  const [freeAt, setFreeAt] = useState(String(s0.freeAt));
  const [maxLb, setMaxLb] = useState(String(s0.maxItemWeightOz / 16));
  const [maxSide, setMaxSide] = useState(String(s0.maxItemSideIn));
  const [credit, setCredit] = useState(String(s0.combineCreditOz));
  const [fbPaper, setFbPaper] = useState(String(s0.fallbackOz.paper));
  const [fbMedia, setFbMedia] = useState(String(s0.fallbackOz.media));
  const [fbBulky, setFbBulky] = useState(String(s0.fallbackOz.bulky));
  const [ground, setGround] = useState(tableToText(s0.groundTable));
  const [media, setMedia] = useState(tableToText(s0.mediaTable));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [testOz, setTestOz] = useState("16");
  const [testMedia, setTestMedia] = useState(false);

  const draft: FiaShipSettings = useMemo(
    () => ({
      groundTable: textToTable(ground),
      mediaTable: textToTable(media),
      handling: Number(handling) || 0,
      freeAt: Number(freeAt) || 0,
      maxItemWeightOz: Math.max(1, (Number(maxLb) || 0) * 16),
      maxItemSideIn: Math.max(1, Number(maxSide) || 0),
      combineCreditOz: Number(credit) || 0,
      fallbackOz: {
        paper: Number(fbPaper) || defaults.fallbackOz.paper,
        media: Number(fbMedia) || defaults.fallbackOz.media,
        bulky: Number(fbBulky) || defaults.fallbackOz.bulky,
      },
    }),
    [ground, media, handling, freeAt, maxLb, maxSide, credit, fbPaper, fbMedia, fbBulky, defaults]
  );

  const test = quoteFiaShipping(
    [
      {
        weightOz: Number(testOz) || 0,
        shipClass: "media",
        mediaEligible: testMedia,
        quantity: 1,
        price: 0.01,
      },
    ],
    { ...draft, freeAt: 0 }
  );

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/fia-shop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ percent: Number(percent), settings: draft }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        percent?: number;
        settings?: FiaShipSettings;
        error?: string;
      };
      if (!res.ok || !data.ok || !data.settings) {
        setMsg(data.error ?? "Save failed.");
        return;
      }
      setPercent(String(data.percent ?? 0));
      setGround(tableToText(data.settings.groundTable));
      setMedia(tableToText(data.settings.mediaTable));
      setMsg("Saved — the site uses these settings now (no deploy needed).");
    } catch {
      setMsg("Save failed — network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="bg-white border border-brand-ink/15 rounded-lg p-5">
        <h2 className="font-medium mb-1">Buy-direct discount</h2>
        <p className="text-sm text-brand-ink/70 mb-3 leading-relaxed">
          foundinalabama.com prices are this percentage below eBay (0 = same
          as eBay). Separate from the TES discount. Items in an eBay markdown
          sale keep whichever discount is bigger, never both.
        </p>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            max={50}
            step={1}
            value={percent}
            onChange={(e) => setPercent(e.target.value)}
            className="w-24 border border-brand-ink/20 rounded-md px-3 py-2 text-sm"
          />
          <span className="text-sm text-brand-ink/70">% off eBay prices</span>
        </div>
      </div>

      <div className="bg-white border border-brand-ink/15 rounded-lg p-5 space-y-5">
        <div>
          <h2 className="font-medium mb-1">Shipping</h2>
          <p className="text-sm text-brand-ink/70 leading-relaxed">
            A cart ships Media Mail when every item&rsquo;s eBay listing offers
            Media Mail, otherwise Ground Advantage. Its weight is the sum of
            the items&rsquo; eBay package weights, less the packaging credit
            for each extra item in the same box. The price is the first table
            row at or above that weight, plus handling.
          </p>
        </div>

        <div className="grid sm:grid-cols-3 gap-4">
          <Field label="Handling per order ($)" hint="Box, tape, filler" value={handling} onChange={setHandling} />
          <Field label="Free shipping at ($)" hint="Merchandise subtotal; 0 = off" value={freeAt} onChange={setFreeAt} />
          <Field label="Packaging credit (oz)" hint="Per extra item in one box" value={credit} onChange={setCredit} step="0.5" />
          <Field label="eBay-only above (lb)" hint="Per item" value={maxLb} onChange={setMaxLb} step="1" />
          <Field label="eBay-only longer than (in)" hint="Any side" value={maxSide} onChange={setMaxSide} step="1" />
        </div>

        <div>
          <p className="text-sm font-medium">Weight when eBay has none (oz)</p>
          <p className="text-xs text-brand-ink/55 mb-2">
            By the store category&rsquo;s ship class (set on the categories admin).
          </p>
          <div className="grid sm:grid-cols-3 gap-4">
            <Field label="Paper" value={fbPaper} onChange={setFbPaper} step="0.5" />
            <Field label="Books & media" value={fbMedia} onChange={setFbMedia} step="0.5" />
            <Field label="Bulky" value={fbBulky} onChange={setFbBulky} step="0.5" />
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-5">
          {(
            [
              ["Ground Advantage", ground, setGround, defaults.groundTable],
              ["Media Mail", media, setMedia, defaults.mediaTable],
            ] as const
          ).map(([label, value, set, def]) => (
            <label key={label} className="block text-sm">
              <span className="font-medium">{label} rates</span>
              <span className="block text-xs text-brand-ink/55">
                One line per step: max ounces, then price (e.g. <code>32 9.95</code>)
              </span>
              <textarea
                value={value}
                onChange={(e) => set(e.target.value)}
                rows={14}
                className="mt-1 w-full font-mono text-xs border border-brand-ink/20 rounded-md px-3 py-2"
              />
              <button
                type="button"
                onClick={() => set(tableToText(def))}
                className="text-xs text-brand-ink/60 underline underline-offset-2 mt-1"
              >
                Reset to starter values
              </button>
            </label>
          ))}
        </div>

        <div className="bg-brand-paper rounded-md p-4 flex flex-wrap items-end gap-4">
          <Field label="Test a weight (oz)" value={testOz} onChange={setTestOz} step="1" />
          <label className="flex items-center gap-2 text-sm pb-2">
            <input
              type="checkbox"
              checked={testMedia}
              onChange={(e) => setTestMedia(e.target.checked)}
            />
            Media Mail
          </label>
          <p className="text-sm pb-2">
            {test.ok
              ? `→ ${fmt(test.shipping)} (${test.service === "media" ? "Media Mail" : "Ground Advantage"})`
              : `→ ${test.error}`}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="px-5 py-2.5 rounded-md bg-brand-ink text-white text-sm font-medium disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save settings"}
        </button>
        {msg && <p className="text-sm text-brand-ink/80">{msg}</p>}
      </div>
    </div>
  );
}
