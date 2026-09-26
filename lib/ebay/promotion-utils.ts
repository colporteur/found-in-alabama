/** eBay counts encoded punctuation toward its description limit. Use plain text. */
export function promotionText(value: string, max: number): string {
  const entities: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
  const decoded = value.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (match, code: string) => {
    if (code[0] !== '#') return entities[code.toLowerCase()] ?? match;
    const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : match;
  }).replace(/\s+/g, ' ').trim();
  // ASCII punctuation avoids the expanded entity lengths seen in eBay errors.
  return decoded.replace(/[›–—]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").slice(0, max).replace(/[\uD800-\uDBFF]$/, '').trim();
}

export function promotionDescription(value: string): string {
  // Keep descriptions plain ASCII and avoid characters eBay HTML-escapes.
  // Full descriptive names are retained separately on the promotion.
  return promotionText(value, 1000).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, 'and').replace(/[<>"']/g, '').replace(/[^\x20-\x7e]/g, ' ')
    .replace(/\s+/g, ' ').slice(0, 50).trim() || 'Special savings';
}

export function saleChanged(local: { status: string; ebayPromotionId: string | null; startsAt: Date; endsAt: Date; lastError: string | null }, remote: RemotePromotion): boolean {
  return local.status !== remoteSaleStatus(remote.promotionStatus)
    || local.ebayPromotionId !== remote.promotionId
    || (remote.startDate !== undefined && +local.startsAt !== Date.parse(remote.startDate))
    || (remote.endDate !== undefined && +local.endsAt !== Date.parse(remote.endDate))
    || !!local.lastError;
}

export function promotionIdFromLocation(location: string | null): string | null {
  if (!location) return null;
  try {
    const url = new URL(location, 'https://api.ebay.com');
    const candidate = url.searchParams.get('promotion_id') ?? url.searchParams.get('promotionId') ?? url.pathname.split('/').filter(Boolean).pop();
    return candidate && /^\d+$/.test(candidate) ? candidate : null;
  } catch { return null; }
}

export type RemotePromotion = {
  promotionId?: string;
  name?: string;
  promotionStatus?: string;
  promotionType?: string;
  startDate?: string;
  endDate?: string;
};

export type SaleStatus = 'DRAFT' | 'SCHEDULED' | 'RUNNING' | 'PAUSED' | 'ENDED' | 'FAILED';
export function remoteSaleStatus(status?: string): SaleStatus | null {
  const normalized = status?.toUpperCase();
  return ['DRAFT', 'SCHEDULED', 'RUNNING', 'PAUSED', 'ENDED'].includes(normalized ?? '')
    ? normalized as SaleStatus : null;
}

export function promotionMatchKey(name: string, start: string | Date, end: string | Date): string {
  return `${name}|${Math.floor(new Date(start).getTime() / 1000)}|${Math.floor(new Date(end).getTime() / 1000)}`;
}

/** Renew ahead of expiry, starting at the old end rather than overlapping it. */
export function renewalStart(now: Date, latestEnd?: Date): Date {
  return new Date(Math.max(now.getTime() + 5 * 60_000, latestEnd?.getTime() ?? 0));
}
