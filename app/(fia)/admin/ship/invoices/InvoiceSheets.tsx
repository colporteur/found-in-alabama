"use client";

// 4 × 6 invoice sheets (layout carried over from the Nifty Pick List
// extension v1.4: grayscale, black on white for the Zebra thermal printer,
// one invoice per label, long orders flow onto more labels). Prices and
// totals are editable before printing; Print records the packages as
// invoiced.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { couponFits } from "@/lib/shop/coupon-fit";

const PICK_ORDER_KEY = "fia.invoices.pickOrder";

export type InvoiceData = {
  id: string;
  /** Position on the pick list for this selection (lower = picked first). */
  pickRank: number;
  brand: "both" | "tes" | "fia";
  venue: string;
  buyer: string | null;
  orderId: string | null;
  date: string;
  shipping: number | null;
  /** Sales tax the buyer paid; the marketplace collects and remits it. */
  salesTax: number | null;
  taxNote: string | null;
  /** Mercari's buyer protection fee. */
  buyerFee: number | null;
  /** Website orders: what an invoice code took off. */
  discount: number | null;
  /** This package's code for the next order on either site (COUPON-1). */
  coupon: {
    code: string;
    percent: number;
    expires: string;
    /** The site the buyer is pitched (COUPON-2); the code works on both. */
    site?: "fia" | "tes";
    /** "theephemeralstate.com has over 4,300 postcards in stock today" */
    stock?: string | null;
    /** QR code (SVG) to that shelf, with the code filled in. */
    qrSvg?: string | null;
  } | null;
  lines: Array<{ id: string; title: string; qty: number; price: number | null; img: string | null; sku: string | null }>;
};

const money = (n: number) => `$${n.toFixed(2)}`;
const parseMoney = (s: string): number | null => {
  const n = Number(s.replace(/[^0-9.]/g, ""));
  return s.replace(/[^0-9.]/g, "") === "" || !Number.isFinite(n) ? null : n;
};

function waitForImages(timeoutMs = 30000): Promise<unknown> {
  const imgs = Array.from(document.images).filter((i) => i.src);
  const loads = imgs
    .filter((i) => !(i.complete && i.naturalWidth > 0))
    .map((i) => new Promise((r) => { i.addEventListener("load", r, { once: true }); i.addEventListener("error", r, { once: true }); }));
  const decodes = imgs.map((i) => (i.decode ? i.decode().catch(() => undefined) : undefined));
  return Promise.race([Promise.all([...loads, ...decodes]), new Promise((r) => setTimeout(r, timeoutMs))]);
}

function Brand({ which }: { which: "fia" | "tes" }) {
  return which === "fia" ? (
    <div className="inv-brand inv-brand-fia">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.png" alt="" className="inv-logo" />
      <div>
        <p className="inv-brand-name">Found in Alabama</p>
        <p className="inv-brand-site">foundinalabama.com</p>
      </div>
    </div>
  ) : (
    <div className="inv-brand inv-brand-tes">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/tes/invoice-logo.png" alt="" className="inv-logo inv-logo-tes" />
      <div>
        <p className="inv-brand-name">The Ephemeral State</p>
        <p className="inv-brand-site">theephemeralstate.com</p>
      </div>
    </div>
  );
}

function Invoice({ inv, photos }: { inv: InvoiceData; photos: boolean }) {
  const [prices, setPrices] = useState<Record<string, number | null>>(
    Object.fromEntries(inv.lines.map((l) => [l.id, l.price == null ? null : l.price * l.qty]))
  );
  const [totalOverride, setTotalOverride] = useState<number | null>(null);
  // Any missing line price leaves the total blank (red $) so it gets noticed.
  const all = Object.values(prices);
  const computed = all.every((p) => p != null)
    ? (all as number[]).reduce((a, b) => a + b, 0) + (inv.shipping ?? 0) + (inv.salesTax ?? 0) + (inv.buyerFee ?? 0) - (inv.discount ?? 0)
    : null;
  const total = totalOverride ?? computed;

  // The code prints only when it fits in the room left on the last label;
  // when it's tight the stock line goes first and the code stays.
  const bodyRef = useRef<HTMLDivElement>(null);
  const couponRef = useRef<HTMLDivElement>(null);
  const stockRef = useRef<HTMLParagraphElement>(null);
  const [fit, setFit] = useState<"full" | "short" | "none">("full");
  const fits = fit !== "none";
  useLayoutEffect(() => {
    if (!inv.coupon || !bodyRef.current || !couponRef.current) return;
    const measure = () => {
      const label = LABEL_CONTENT_IN * 96;
      const body = bodyRef.current!.offsetHeight;
      const st = stockRef.current;
      const stockH = st ? st.offsetHeight + 3 : 0;
      const inFlow = !!st && !st.classList.contains("inv-stock-skip");
      const base = couponRef.current!.offsetHeight - (inFlow ? stockH : 0);
      setFit(st && couponFits(body, base + stockH, label) ? "full" : couponFits(body, base, label) ? (st ? "short" : "full") : "none");
    };
    measure();
    const imgs = Array.from(bodyRef.current.querySelectorAll("img"));
    imgs.forEach((i) => i.addEventListener("load", measure));
    return () => imgs.forEach((i) => i.removeEventListener("load", measure));
  }, [inv.coupon, photos, prices]);

  return (
    <div className="invoice">
      <div ref={bodyRef}>
      <div className={`inv-brands ${inv.brand === "both" ? "" : "inv-brands-single"}`}>
        {inv.brand !== "fia" && <Brand which="tes" />}
        {inv.brand !== "tes" && <Brand which="fia" />}
      </div>
      <div className="inv-saleline">
        <span>
          Sold on <b>{inv.venue}</b>
          {inv.buyer && (
            <>
              {" "}to <b>{inv.buyer}</b>
            </>
          )}
        </span>
        <span>{inv.date}</span>
      </div>
      {inv.orderId && <div className="inv-saleline">Order {inv.orderId}</div>}
      <div className="inv-lines">
        {inv.lines.map((l) => (
          <div key={l.id} className="inv-line">
            {photos &&
              (l.img ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={l.img} alt="" className="inv-thumb" loading="eager" />
              ) : null)}
            <div className="inv-line-text">
              <p className="inv-title">{l.title}</p>
              {(l.qty > 1 || l.sku) && (
                <p className="inv-qty">
                  {l.sku && <span className="inv-sku">Bin {l.sku}</span>}
                  {l.sku && l.qty > 1 && " · "}
                  {l.qty > 1 && `Qty ${l.qty}`}
                </p>
              )}
            </div>
            <span
              className={`inv-line-price ${prices[l.id] == null ? "price-missing" : ""}`}
              contentEditable
              suppressContentEditableWarning
              spellCheck={false}
              title="Click to edit"
              onBlur={(e) => {
                const v = parseMoney(e.currentTarget.textContent ?? "");
                setPrices((p) => ({ ...p, [l.id]: v }));
                setTotalOverride(null);
                e.currentTarget.textContent = v == null ? "$" : money(v);
              }}
            >
              {prices[l.id] == null ? "$" : money(prices[l.id]!)}
            </span>
          </div>
        ))}
      </div>
      {inv.shipping != null && (
        <div className="inv-saleline">
          <span>Shipping</span>
          <span>{money(inv.shipping)}</span>
        </div>
      )}
      {inv.buyerFee != null && inv.buyerFee > 0 && (
        <div className="inv-saleline">
          <span>Buyer protection fee</span>
          <span>{money(inv.buyerFee)}</span>
        </div>
      )}
      {inv.discount != null && inv.discount > 0 && (
        <div className="inv-saleline">
          <span>Code discount</span>
          <span>−{money(inv.discount)}</span>
        </div>
      )}
      {inv.salesTax != null && inv.salesTax > 0 && (
        <div className="inv-saleline">
          <span>
            Sales tax{inv.taxNote && <span className="inv-note"> ({inv.taxNote})</span>}
          </span>
          <span>{money(inv.salesTax)}</span>
        </div>
      )}
      <div className="inv-total">
        <span className="inv-total-label">Total</span>
        <span
          key={String(computed)}
          className={`inv-price ${total == null ? "price-missing" : ""}`}
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          title="Click to edit"
          onBlur={(e) => {
            const v = parseMoney(e.currentTarget.textContent ?? "");
            setTotalOverride(v);
            e.currentTarget.textContent = v == null ? (computed == null ? "$" : money(computed)) : money(v);
          }}
        >
          {total == null ? "$" : money(total)}
        </span>
      </div>
      <div className="inv-footer">
        {inv.brand === "tes"
          ? "Thank you for supporting The Ephemeral State!"
          : inv.brand === "fia"
            ? "Thank you for supporting Found in Alabama!"
            : "Thank you for supporting our small businesses!"}
      </div>
      </div>
      {inv.coupon && (
        <div ref={couponRef} className={`inv-coupon ${fits ? "" : "inv-coupon-skip"} ${inv.coupon.qrSvg ? "inv-coupon-withqr" : ""}`}>
          {inv.coupon.qrSvg && <div className="inv-coupon-qr" dangerouslySetInnerHTML={{ __html: inv.coupon.qrSvg }} />}
          <div className="inv-coupon-text">
            <p className="inv-coupon-head">{inv.coupon.percent}% OFF your next order</p>
            <p className="inv-coupon-code">{inv.coupon.code}</p>
            <p className="inv-coupon-sites">
              {(() => {
                const [main, other] = inv.coupon.site === "tes" ? ["theephemeralstate.com", "foundinalabama.com"] : ["foundinalabama.com", "theephemeralstate.com"];
                // The stock line already names the main site.
                return inv.coupon.stock && fit === "full" ? `Good at ${main} or ${other}` : `${main} or ${other}`;
              })()}
            </p>
            {inv.coupon.stock && (
              <p ref={stockRef} className={`inv-coupon-stock ${fit === "short" ? "inv-stock-skip" : ""}`}>
                {inv.coupon.stock}
              </p>
            )}
            <p className="inv-coupon-fine">
              {inv.coupon.qrSvg ? "Scan, or enter the code at checkout" : "Enter the code at checkout"} · one use · good through {inv.coupon.expires}
            </p>
          </div>
        </div>
      )}
      {inv.coupon && !fits && <p className="no-print inv-coupon-note">No room for the coupon code on this label — it will be left off.</p>}
      {inv.coupon && fit === "short" && <p className="no-print inv-coupon-note">Tight on room: the stock line is left off; the code still prints.</p>}
    </div>
  );
}

/** Printable height of a 4 × 6 label: 6in less the 0.15in @page margins. */
const LABEL_CONTENT_IN = 6 - 0.3;

export function InvoiceSheets({ invoices }: { invoices: InvoiceData[] }) {
  const [photos, setPhotos] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // On by default; the choice is remembered on this computer.
  const [pickSorted, setPickSorted] = useState(true);
  useEffect(() => {
    try {
      if (localStorage.getItem(PICK_ORDER_KEY) === "0") setPickSorted(false);
    } catch {}
  }, []);
  const choosePickSorted = (on: boolean) => {
    setPickSorted(on);
    try {
      localStorage.setItem(PICK_ORDER_KEY, on ? "1" : "0");
    } catch {}
  };
  const shown = useMemo(
    () => (pickSorted ? [...invoices].sort((a, b) => a.pickRank - b.pickRank) : invoices),
    [invoices, pickSorted]
  );
  const missing = invoices.filter((i) => i.lines.some((l) => l.price == null)).length;

  async function print() {
    setBusy(true);
    try {
      await waitForImages();
      const res = await fetch("/api/admin/ship", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "invoice_printed", ids: invoices.map((i) => i.id) }),
      });
      setNote(res.ok ? null : "Couldn't record these invoices (printing anyway).");
    } catch {
      setNote("Couldn't record these invoices (printing anyway).");
    } finally {
      setBusy(false);
    }
    window.print();
  }

  return (
    <div className="inv-page">
      <style>{INVOICE_CSS}</style>
      <div className="no-print inv-toolbar">
        <div>
          <b>Invoices</b> · {invoices.length} label{invoices.length === 1 ? "" : "s"}
          {missing > 0 && <span className="inv-warn"> · {missing} with a missing price (red $ — click to type it)</span>}
        </div>
        <label>
          <input type="checkbox" checked={photos} onChange={(e) => setPhotos(e.target.checked)} /> Photos
        </label>
        <label title="Print the labels in the same order as the pick list for these packages, so they come off the printer already sorted.">
          <input type="checkbox" checked={pickSorted} onChange={(e) => choosePickSorted(e.target.checked)} /> Pick list order
        </label>
        <button type="button" onClick={print} disabled={busy || !invoices.length}>
          {busy ? "Loading photos…" : "Print"}
        </button>
        {note && <span>{note}</span>}
      </div>
      <p className="no-print inv-hint">
        Zebra TLP 2844 · portrait · paper 4 × 6 in · scale 100% · headers and footers off. Prices are what the sale
        recorded; if you took an offer, click a price to change it.
      </p>
      {!invoices.length && <p className="no-print inv-hint">No packages selected.</p>}
      {shown.map((inv) => (
        <Invoice key={inv.id} inv={inv} photos={photos} />
      ))}
    </div>
  );
}

const INVOICE_CSS = `
  .inv-page { background: #e9e5da; padding: 12px 0 40px; font-family: Inter, "Segoe UI", Roboto, Arial, sans-serif; color: #000; }
  .inv-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 14px; max-width: 760px; margin: 0 auto; padding: 10px 16px;
    background: #faf7f0; border-bottom: 3px solid #fcc419; font-size: 14px; }
  .inv-toolbar button { padding: 7px 20px; border: 0; border-radius: 6px; background: #fcc419; font-weight: 600; cursor: pointer; }
  .inv-toolbar button:disabled { opacity: .5; }
  .inv-warn { color: #b00020; }
  .inv-hint { max-width: 760px; margin: 10px auto 0; padding: 0 16px; font-size: 12.5px; color: #666; }
  .invoice { position: relative; width: 4in; min-height: 6in; margin: 20px auto; padding: 0.15in; background: #fff; color: #000;
    box-shadow: 0 2px 10px rgba(0,0,0,.15); }
  .inv-brands { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; padding-bottom: 8px; border-bottom: 1px solid #000; }
  .inv-brands-single { justify-content: flex-start; }
  .inv-brand { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .inv-brands:not(.inv-brands-single) .inv-brand-fia { flex-direction: row-reverse; text-align: right; }
  .inv-logo { width: 0.55in; height: 0.55in; object-fit: contain; filter: grayscale(1); flex: 0 0 auto; }
  /* Black line art made for the thermal printer (public/tes/invoice-logo.png). */
  .inv-logo-tes { width: 0.95in; height: 0.65in; filter: none; }
  .inv-brand-name { margin: 0; font-size: 12px; font-weight: 700; line-height: 1.2; }
  .inv-brand-site { margin: 2px 0 0; font-size: 10px; }
  .inv-saleline { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 6px; margin-top: 8px; font-size: 11px; overflow-wrap: anywhere; }
  .inv-note { font-size: 10px; }
  .inv-lines { margin-top: 4px; }
  .inv-line { display: flex; gap: 8px; align-items: center; padding: 8px 0; border-bottom: 1px solid #000; }
  .inv-line:last-child { border-bottom: 0; }
  .inv-thumb { width: 0.5in; height: 0.5in; object-fit: cover; filter: grayscale(1); flex: 0 0 auto; }
  .inv-line-text { flex: 1; min-width: 0; }
  .inv-title { margin: 0; font-size: 12px; font-weight: 600; line-height: 1.3; overflow-wrap: anywhere; }
  .inv-qty { margin: 3px 0 0; font-size: 11px; }
  .inv-sku { font-family: ui-monospace, Menlo, Consolas, monospace; font-weight: 700; font-size: 12px; }
  .inv-line-price, .inv-price { padding: 2px; border: 1px dashed transparent; border-radius: 4px; text-align: right; white-space: nowrap; font-weight: 600; }
  .inv-line-price { min-width: 48px; font-size: 12px; }
  .inv-price { min-width: 65px; font-size: 18px; font-weight: 700; }
  .inv-line-price:hover, .inv-line-price:focus, .inv-price:hover, .inv-price:focus { border-color: #e5a800; outline: none; background: #fff; }
  .price-missing { color: #b00020; }
  .inv-total { display: flex; justify-content: flex-end; align-items: baseline; gap: 8px; margin-top: 10px; padding-top: 7px; border-top: 1px solid #000; }
  .inv-total-label { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; }
  .inv-footer { margin-top: 12px; font-size: 10px; text-align: center; }
  .inv-coupon { margin-top: 14px; padding: 8px 6px; border: 3px dashed #000; border-radius: 6px; text-align: center; break-inside: avoid; }
  .inv-coupon p { margin: 0; }
  .inv-coupon-head { font-size: 16px; font-weight: 800; letter-spacing: .02em; }
  .inv-coupon-code { margin: 4px 0 !important; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 30px; font-weight: 900; letter-spacing: .08em; }
  .inv-coupon-sites { font-size: 11px; font-weight: 700; }
  .inv-coupon-fine { margin-top: 2px !important; font-size: 9.5px; }
  /* kept in the layout (invisible) so it can be re-measured after an edit */
  .inv-coupon-withqr { display: flex; align-items: center; gap: 8px; text-align: left; }
  .inv-coupon-withqr .inv-coupon-text { flex: 1; min-width: 0; text-align: center; }
  .inv-coupon-qr { width: 0.85in; height: 0.85in; flex: 0 0 auto; }
  .inv-coupon-qr svg { width: 100%; height: 100%; display: block; }
  .inv-coupon-stock { margin-top: 3px !important; font-size: 11px; font-weight: 700; line-height: 1.25; }
  .inv-stock-skip { position: absolute; visibility: hidden; left: 0; right: 0; }
  .inv-coupon-skip { position: absolute; left: 0.15in; right: 0.15in; visibility: hidden; }
  .inv-coupon-note { margin: 8px 0 0; font-size: 11px; color: #b00020; text-align: center; }
  @page { size: 4in 6in; margin: 0.15in; }
  @media print {
    html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; min-height: 0 !important; display: block !important; }
    body header, body footer, body nav, .no-print { display: none !important; }
    .inv-page { padding: 0; background: #fff; }
    .invoice { width: auto; min-height: 0; margin: 0; padding: 0; box-shadow: none; break-after: page; }
    .invoice:last-child { break-after: auto; }
    .inv-brands, .inv-saleline, .inv-line, .inv-total, .inv-footer { break-inside: avoid; }
    .inv-brands, .inv-saleline { break-after: avoid; }
    .inv-total, .inv-footer { break-before: avoid; }
    .inv-price, .inv-line-price { border-color: transparent !important; color: #000 !important; }
    .inv-coupon-skip, .inv-stock-skip { display: none !important; }
  }
`;
