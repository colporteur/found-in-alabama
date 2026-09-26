import { db } from '@/db';
import { ebaySales, ebaySaleAuditLog, appSettings } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { sellApi } from './sell-api';
import { promotionMatchKey, remoteSaleStatus, saleChanged, type RemotePromotion } from './promotion-utils';

export async function syncSaleStatuses() {
  const promotions: RemotePromotion[] = [];
  const limit = 100;
  for (let offset = 0; ; offset += limit) {
    if (offset >= 10_000) throw new Error('Promotion list exceeded safety limit; no partial sync applied.');
    const page = await sellApi<{ promotions?: RemotePromotion[]; total?: number }>(
      `/sell/marketing/v1/promotion?marketplace_id=EBAY_US&limit=${limit}&offset=${offset}`
    );
    if (!Array.isArray(page.promotions)) throw new Error('eBay returned an invalid promotion list.');
    promotions.push(...page.promotions);
    if (page.promotions.length < limit || (page.total !== undefined && promotions.length >= page.total)) break;
  }
  const byId = new Map(promotions.filter(p => p.promotionId).map(p => [p.promotionId!, p]));
  const byKey = new Map<string, RemotePromotion[]>();
  for (const p of promotions) {
    if (!p.name || !p.startDate || !p.endDate || !p.promotionId) continue;
    const key = promotionMatchKey(p.name, p.startDate, p.endDate);
    byKey.set(key, [...(byKey.get(key) ?? []), p]);
  }
  const rows = await db.select().from(ebaySales);
  const localKeys = new Map<string, number>();
  for (const row of rows) {
    const key = promotionMatchKey(row.name, row.startsAt, row.endsAt);
    localKeys.set(key, (localKeys.get(key) ?? 0) + 1);
  }
  const assigned = new Set(rows.map(r => r.ebayPromotionId).filter(Boolean));
  let updated = 0, recovered = 0, unmatched = 0;
  const unresolvedCurrent: string[] = [];
  const now = new Date();
  // Bound database concurrency while repairing hundreds of legacy rows.
  const patches: { id: string; patch: Partial<typeof ebaySales.$inferInsert> }[] = [];
  for (const row of rows) {
    let remote = row.ebayPromotionId ? byId.get(row.ebayPromotionId) : undefined;
    if (!row.ebayPromotionId) {
      const key = promotionMatchKey(row.name, row.startsAt, row.endsAt);
      const candidates = byKey.get(key) ?? [];
      if (localKeys.get(key) === 1 && candidates.length === 1 && !assigned.has(candidates[0].promotionId!)) {
        remote = candidates[0];
        assigned.add(remote.promotionId!);
        recovered++;
      }
    }
    const status = remoteSaleStatus(remote?.promotionStatus);
    if (!remote || !status) {
      if (row.ebayPromotionId || ['RUNNING', 'SCHEDULED'].includes(row.status)) unmatched++;
      if (row.endsAt > now && (['RUNNING', 'SCHEDULED'].includes(row.status) || /timeout|timed out|no promotion ID|fetch failed|HTTP 5\d\d/i.test(row.lastError ?? '')) && row.scope.autoTierKey && !row.scope.autoTierKey.startsWith('wizard:')) {
        unresolvedCurrent.push(row.name);
      }
      // Expired local schedules cannot be live even when remote history is unavailable.
      if (row.endsAt <= now && ['RUNNING', 'SCHEDULED'].includes(row.status)) {
        patches.push({ id: row.id, patch: { status: 'ENDED', updatedAt: now } });
      }
      continue;
    }
    const start = remote.startDate ? new Date(remote.startDate) : row.startsAt;
    const end = remote.endDate ? new Date(remote.endDate) : row.endsAt;
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) throw new Error('Invalid eBay promotion dates');
    if (saleChanged(row, remote)) {
      patches.push({ id: row.id, patch: { status, ebayPromotionId: remote.promotionId, startsAt: start, endsAt: end, lastError: null, updatedAt: now } });
    }
  }
  for (let i = 0; i < patches.length; i += 20) {
    await Promise.all(patches.slice(i, i + 20).map(p => db.update(ebaySales).set(p.patch).where(eq(ebaySales.id, p.id))));
    updated += patches.slice(i, i + 20).length;
  }
  const summary = { ok: true, promotionsFetched: byId.size, localRows: rows.length, updated, recovered, unmatched, unresolvedCurrent, checkedAt: now.toISOString() };
  await db.insert(appSettings).values({ key: 'ebaySalesLastSync', value: summary, updatedAt: now })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: summary, updatedAt: now } });
  await db.insert(ebaySaleAuditLog).values({ action: 'sync-status', success: true, details: summary });
  return summary;
}
