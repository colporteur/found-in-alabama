"use client";

// DYMO LabelWriter 330 Turbo, stock 11354 (57 × 32 mm, landscape) — the
// Nifty Inventory Label Printer v3.5 layout:
//   +--------------------------------+--------+
//   |          Item title            |  logo  |
//   |       (shrink-to-fit)          +--------+
//   |                                | $price |
//   +--------------------------------+--------+
// Title and price are click-to-edit; edits re-fit the text.

import { useEffect, useRef, useState } from "react";

type Label = { key: string; title: string; price: number | null };

function fit(root: HTMLElement | null) {
  if (!root) return;
  root.querySelectorAll<HTMLElement>(".lbl").forEach((label) => {
    const cell = label.querySelector<HTMLElement>(".lbl-name");
    const text = label.querySelector<HTMLElement>(".lbl-name-text");
    if (cell && text) {
      let pt = 22;
      text.style.fontSize = `${pt}pt`;
      while (pt > 6 && (text.scrollWidth > cell.clientWidth || text.scrollHeight > cell.clientHeight)) {
        pt -= 1;
        text.style.fontSize = `${pt}pt`;
      }
    }
    const price = label.querySelector<HTMLElement>(".lbl-price");
    if (price) {
      let pt = 16;
      price.style.fontSize = `${pt}pt`;
      while (pt > 8 && price.scrollWidth > price.clientWidth) {
        pt -= 1;
        price.style.fontSize = `${pt}pt`;
      }
    }
  });
}

export function LabelSheets({ items }: { items: Label[] }) {
  const root = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fit(root.current);
    const img = root.current?.querySelector("img");
    if (img && !img.complete) img.addEventListener("load", () => fit(root.current), { once: true });
  }, []);

  async function print() {
    setBusy(true);
    const imgs = Array.from(root.current?.querySelectorAll("img") ?? []);
    await Promise.race([
      Promise.all(imgs.map((i) => (i.complete ? Promise.resolve() : new Promise((r) => i.addEventListener("load", r, { once: true }))))),
      new Promise((r) => setTimeout(r, 4000)),
    ]);
    fit(root.current);
    setBusy(false);
    window.print();
  }

  return (
    <div className="lbl-page">
      <style>{LABEL_CSS}</style>
      <div className="no-print lbl-toolbar">
        <b>Labels</b> · {items.length}
        <button type="button" onClick={print} disabled={busy || !items.length}>
          {busy ? "Loading…" : "Print"}
        </button>
        <span className="lbl-hint">
          DYMO LabelWriter 330 Turbo · 11354 (57 × 32 mm) · landscape · margins none · scale 100%. Click a title or price
          to change it.
        </span>
      </div>
      {!items.length && <p className="no-print lbl-hint">No items selected.</p>}
      <div ref={root}>
        {items.map((i) => (
          <section key={i.key} className="lbl">
            <div className="lbl-content">
              <div className="lbl-name">
                <span
                  className="lbl-name-text"
                  contentEditable
                  suppressContentEditableWarning
                  spellCheck={false}
                  onBlur={() => fit(root.current)}
                >
                  {i.title}
                </span>
              </div>
              <div className="lbl-side">
                <div className="lbl-logo">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/logo.png" alt="Found in Alabama" />
                </div>
                <div className="lbl-price" contentEditable suppressContentEditableWarning spellCheck={false} onBlur={() => fit(root.current)}>
                  {i.price != null ? `$${i.price.toFixed(2)}` : ""}
                </div>
              </div>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

const LABEL_CSS = `
  @page { size: 57mm 32mm; margin: 0; }
  .lbl-page { font-family: Arial, Helvetica, sans-serif; color: #000; background: #eef2f7; padding: 16px; min-height: 60vh; }
  .lbl-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-bottom: 14px; font-size: 14px; }
  .lbl-toolbar button { padding: 6px 18px; border: 0; border-radius: 6px; background: #fcc419; font-weight: 600; cursor: pointer; }
  .lbl-toolbar button:disabled { opacity: .5; }
  .lbl-hint { font-size: 12px; color: #555; }
  .lbl { width: 57mm; height: 32mm; overflow: hidden; background: #fff; border: 1px solid #cbd5e1; border-radius: 4px; margin-bottom: 10px;
    -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .lbl-content { width: 57mm; height: 32mm; box-sizing: border-box; padding: 1.5mm; display: flex; gap: 1.5mm; }
  .lbl-name { flex: 1; min-width: 0; display: flex; align-items: center; justify-content: center; text-align: center; overflow: hidden; }
  .lbl-name-text { display: inline-block; font-weight: 700; font-size: 22pt; line-height: 1.12; word-break: break-word; hyphens: auto; outline: none; }
  .lbl-side { width: 21mm; height: 29mm; flex-shrink: 0; display: flex; flex-direction: column; align-items: center; gap: 0.6mm; }
  .lbl-logo { width: 21mm; height: 21mm; display: flex; align-items: center; justify-content: center; }
  .lbl-logo img { max-width: 100%; max-height: 100%; display: block; }
  .lbl-price { width: 21mm; height: 7mm; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 16pt;
    line-height: 1; white-space: nowrap; outline: none; }
  @media print {
    html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; min-height: 0 !important; display: block !important; }
    body header, body footer, body nav, .no-print { display: none !important; }
    .lbl-page { padding: 0; background: #fff; min-height: 0; }
    .lbl { border: 0; border-radius: 0; margin: 0; break-after: page; page-break-after: always; }
    .lbl:last-child { break-after: auto; page-break-after: auto; }
  }
`;
