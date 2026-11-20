// Pure: does the invoice coupon block fit in the room left on the last
// 4 × 6 label? Long invoices flow onto more labels, so only the remainder of
// the last one counts. A little slack covers the page-break rounding.
export function couponFits(bodyPx: number, couponPx: number, labelPx: number, slackPx = 12): boolean {
  if (!(labelPx > 0) || !(couponPx > 0)) return false;
  if (couponPx + slackPx > labelPx) return false;
  const used = bodyPx % labelPx;
  // Exactly full last label: the coupon would start a blank label — skip it.
  if (bodyPx > 0 && used === 0) return false;
  return used + couponPx + slackPx <= labelPx;
}

export type CouponLayout = {
  /** full = big box with the stock line; short = big box without it;
   *  compact = small box (no QR, no stock line); none = no code on the label. */
  fit: "full" | "short" | "compact" | "none";
  /** Print the "Thank you for supporting …" footer. */
  footer: boolean;
};

// Pure: pick the biggest coupon box that fits on the last label, in this order:
//   1. the full box (with the stock line, then without it), footer kept;
//   2. Alabama invoices only: drop the thank-you footer (the Alabama Neighbor
//      box already thanks them) and try the full box again;
//   3. the compact box (no QR, no stock line) — without the footer on
//      Alabama invoices, with it on the rest;
//   4. no code (the footer comes back; the DYMO label covers the code).
// Heights are in px. `bodyPx` is the invoice body WITH the footer.
export function planCouponLayout(m: {
  bodyPx: number;
  footerPx: number;
  /** The full box without the stock line. */
  fullPx: number;
  /** The stock line's extra height (0 when there's no stock line). */
  stockPx: number;
  compactPx: number;
  labelPx: number;
  alabama: boolean;
}): CouponLayout {
  const big = (body: number): CouponLayout["fit"] | null =>
    m.stockPx > 0 && couponFits(body, m.fullPx + m.stockPx, m.labelPx)
      ? "full"
      : couponFits(body, m.fullPx, m.labelPx)
        ? m.stockPx > 0 ? "short" : "full"
        : null;
  const withFooter = m.bodyPx;
  const withoutFooter = Math.max(0, m.bodyPx - m.footerPx);

  const a = big(withFooter);
  if (a) return { fit: a, footer: true };
  if (m.alabama && m.footerPx > 0) {
    const b = big(withoutFooter);
    if (b) return { fit: b, footer: false };
  }
  const body = m.alabama ? withoutFooter : withFooter;
  if (m.compactPx > 0 && couponFits(body, m.compactPx, m.labelPx)) return { fit: "compact", footer: !m.alabama };
  return { fit: "none", footer: true };
}
