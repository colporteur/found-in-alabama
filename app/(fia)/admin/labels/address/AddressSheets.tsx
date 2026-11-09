"use client";

// Buyer address labels on the DYMO LabelWriter 330 Turbo, stock 11354
// (57 × 32 mm, landscape) — the same printer setup as the item labels.
// The address shrinks to fit; click it to edit before printing.

import { useEffect, useRef } from "react";

type Label = { key: string; lines: string[] };

// Shrink the address until it fits the label's printable area (the cell
// minus its padding, with a little slack for the printer). If a line is
// still too wide at a readable size, let lines wrap with a hanging indent
// and keep shrinking until the whole block fits the height.
const MIN_NOWRAP_PT = 9;
const SLACK_PX = 3;

function fit(root: HTMLElement | null) {
  root?.querySelectorAll<HTMLElement>(".adr").forEach((label) => {
    const cell = label.querySelector<HTMLElement>(".adr-cell");
    const text = label.querySelector<HTMLElement>(".adr-text");
    if (!cell || !text) return;
    const cs = getComputedStyle(cell);
    const availW = cell.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - SLACK_PX;
    const availH = cell.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - SLACK_PX;
    const tooBig = () => text.scrollWidth > availW || text.scrollHeight > availH;

    let pt = 14;
    text.classList.remove("adr-wrap");
    text.style.width = "";
    text.style.fontSize = `${pt}pt`;
    while (pt > MIN_NOWRAP_PT && tooBig()) {
      pt -= 0.5;
      text.style.fontSize = `${pt}pt`;
    }
    if (!tooBig()) return;

    // Still too wide: wrap long lines instead of shrinking to unreadable.
    text.classList.add("adr-wrap");
    text.style.width = `${availW}px`;
    pt = 12;
    text.style.fontSize = `${pt}pt`;
    while (pt > 5 && tooBig()) {
      pt -= 0.5;
      text.style.fontSize = `${pt}pt`;
    }
  });
}

export function AddressSheets({ labels }: { labels: Label[] }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => fit(root.current), []);

  return (
    <div className="adr-page">
      <style>{CSS}</style>
      <div className="no-print adr-toolbar">
        <button
          type="button"
          disabled={!labels.length}
          onClick={() => {
            fit(root.current);
            window.print();
          }}
        >
          Print
        </button>
        <span className="adr-hint">
          DYMO LabelWriter 330 Turbo · 11354 (57 × 32 mm) · landscape · margins none · scale 100%. Click the address to edit it.
        </span>
      </div>
      {!labels.length && <p className="no-print adr-hint">No address found for that order.</p>}
      <div ref={root}>
        {labels.map((l) => (
          <div key={l.key} className="adr">
            <div className="adr-cell">
              <div
                className="adr-text"
                contentEditable
                suppressContentEditableWarning
                onInput={() => fit(root.current)}
              >
                {l.lines.length ? l.lines.map((line, i) => <div key={i}>{line}</div>) : <div>(no address on file)</div>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const CSS = `
  @page { size: 57mm 32mm; margin: 0; }
  .adr-page { font-family: Arial, Helvetica, sans-serif; color: #000; background: #eef2f7; padding: 16px; min-height: 60vh; }
  .adr-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-bottom: 14px; font-size: 14px; }
  .adr-toolbar button { padding: 6px 18px; border: 0; border-radius: 6px; background: #fcc419; font-weight: 600; cursor: pointer; }
  .adr-toolbar button:disabled { opacity: .5; }
  .adr-hint { font-size: 12px; color: #555; }
  .adr { width: 57mm; height: 32mm; overflow: hidden; background: #fff; border: 1px solid #cbd5e1; border-radius: 4px; margin-bottom: 10px; }
  .adr-cell { width: 57mm; height: 32mm; box-sizing: border-box; padding: 2mm 2.5mm; display: flex; align-items: center; overflow: hidden; }
  .adr-text { font-weight: 700; font-size: 14pt; line-height: 1.15; outline: none; white-space: nowrap; min-width: 0; }
  .adr-text.adr-wrap { white-space: normal; overflow-wrap: anywhere; }
  .adr-text.adr-wrap > div { padding-left: 1.2em; text-indent: -1.2em; }
  @media print {
    html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; min-height: 0 !important; display: block !important; }
    body header, body footer, body nav, .no-print { display: none !important; }
    .adr-page { padding: 0; background: #fff; min-height: 0; }
    .adr { border: 0; border-radius: 0; margin: 0; break-after: page; page-break-after: always; }
    .adr:last-child { break-after: auto; page-break-after: auto; }
  }
`;
