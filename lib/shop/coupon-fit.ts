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
