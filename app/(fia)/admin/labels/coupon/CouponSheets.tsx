"use client";

// Invoice coupon codes on the DYMO LabelWriter 330 Turbo, stock 11354
// (57 × 32 mm, landscape) — the same printer setup as the address labels.
// Black on white, heavy type, no QR code. The code shrinks to fit the width.

import { useEffect, useMemo, useRef, useState } from "react";

export type CouponLabel = {
  key: string;
  /** "@buyer · eBay" — on screen only, to match a label to its package. */
  who: string;
  alabama: boolean;
  coupon: { code: string; percent: number; site: "fia" | "tes"; expires: string } | null;
};

const SITES = { fia: ["foundinalabama.com", "theephemeralstate.com"], tes: ["theephemeralstate.com", "foundinalabama.com"] } as const;

function fit(root: HTMLElement | null) {
  root?.querySelectorAll<HTMLElement>(".cpn").forEach((label) => {
    const code = label.querySelector<HTMLElement>(".cpn-code");
    if (!code) return;
    const avail = label.clientWidth - 2 * 9 - 2; // 2.5mm padding each side, a little slack
    let pt = 20;
    code.style.fontSize = `${pt}pt`;
    while (pt > 11 && code.scrollWidth > avail) {
      pt -= 0.5;
      code.style.fontSize = `${pt}pt`;
    }
  });
}

export function CouponSheets({ labels }: { labels: CouponLabel[] }) {
  const root = useRef<HTMLDivElement>(null);
  const withCode = useMemo(() => labels.filter((l) => l.coupon), [labels]);
  const without = labels.length - withCode.length;
  const [sel, setSel] = useState<Set<string>>(() => new Set(withCode.map((l) => l.key)));
  useEffect(() => fit(root.current), [sel]);
  const shown = withCode.filter((l) => sel.has(l.key));

  return (
    <div className="cpn-page">
      <style>{CSS}</style>
      <div className="no-print cpn-toolbar">
        <button
          type="button"
          disabled={!shown.length}
          onClick={() => {
            fit(root.current);
            window.print();
          }}
        >
          Print {shown.length} label{shown.length === 1 ? "" : "s"}
        </button>
        <span className="cpn-hint">
          DYMO LabelWriter 330 Turbo · 11354 (57 × 32 mm) · landscape · margins none · scale 100%. Same code as the
          package&apos;s invoice.
        </span>
      </div>
      {without > 0 && (
        <p className="no-print cpn-hint">
          {without} package{without === 1 ? " has" : "s have"} no code (that venue is switched off in Invoice coupons, or
          Stripe didn&apos;t answer).
        </p>
      )}
      {!labels.length && <p className="no-print cpn-hint">No packages selected.</p>}
      {withCode.length > 1 && (
        <div className="no-print cpn-list">
          {withCode.map((l) => (
            <label key={l.key}>
              <input
                type="checkbox"
                checked={sel.has(l.key)}
                onChange={() =>
                  setSel((s) => {
                    const n = new Set(s);
                    if (n.has(l.key)) n.delete(l.key);
                    else n.add(l.key);
                    return n;
                  })
                }
              />{" "}
              {l.who || "package"} · <b>{l.coupon!.code}</b>
              {l.alabama && " · ★ AL"}
            </label>
          ))}
        </div>
      )}
      <div ref={root}>
        {shown.map((l) => {
          const c = l.coupon!;
          const [main, other] = SITES[c.site];
          return (
            <div key={l.key} className="cpn-wrap">
              <p className="no-print cpn-who">
                {l.who}
                {l.alabama && " · ★ Alabama — add a sticker"}
              </p>
              <div className="cpn">
                <p className="cpn-head">{c.percent}% OFF your next order</p>
                <p className="cpn-code">{c.code}</p>
                <p className="cpn-sites">
                  {main}
                  <br />
                  or {other}
                </p>
                <p className="cpn-fine">Enter the code at checkout · one use · good through {c.expires}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const CSS = `
  @page { size: 57mm 32mm; margin: 0; }
  .cpn-page { font-family: Arial, Helvetica, sans-serif; color: #000; background: #eef2f7; padding: 16px; min-height: 60vh; }
  .cpn-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-bottom: 14px; font-size: 14px; }
  .cpn-toolbar button { padding: 6px 18px; border: 0; border-radius: 6px; background: #fcc419; font-weight: 600; cursor: pointer; }
  .cpn-toolbar button:disabled { opacity: .5; }
  .cpn-hint { font-size: 12px; color: #555; }
  .cpn-list { display: flex; flex-direction: column; gap: 4px; margin: 0 0 14px; font-size: 13px; }
  .cpn-who { margin: 0 0 3px; font-size: 12px; color: #444; }
  .cpn-wrap { margin-bottom: 12px; }
  .cpn { width: 57mm; height: 32mm; box-sizing: border-box; padding: 1.8mm 2.5mm; overflow: hidden; background: #fff;
    border: 1px solid #cbd5e1; border-radius: 4px; display: flex; flex-direction: column; justify-content: center;
    align-items: center; text-align: center; }
  .cpn p { margin: 0; color: #000; }
  .cpn-head { font-size: 10pt; font-weight: 900; line-height: 1.1; letter-spacing: .01em; }
  .cpn-code { margin: 1mm 0 0.8mm !important; font-family: Consolas, "Courier New", monospace; font-size: 20pt; font-weight: 900;
    letter-spacing: .06em; line-height: 1; white-space: nowrap; }
  .cpn-sites { font-size: 7.5pt; font-weight: 700; line-height: 1.2; }
  .cpn-fine { margin-top: 0.8mm !important; font-size: 6pt; font-weight: 700; line-height: 1.15; }
  @media print {
    html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; min-height: 0 !important; display: block !important; }
    body header, body footer, body nav, .no-print { display: none !important; }
    .cpn-page { padding: 0; background: #fff; min-height: 0; }
    .cpn-wrap { margin: 0; break-after: page; page-break-after: always; }
    .cpn-wrap:last-child { break-after: auto; page-break-after: auto; }
    .cpn { border: 0; border-radius: 0; }
  }
`;
