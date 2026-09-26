import { randomUUID } from 'node:crypto';
import { db } from '@/db';
import { appSettings, ebaySales, ebaySaleAuditLog } from '@/db/schema';
import { eq, sql } from 'drizzle-orm';
import { getTiers, getBinTiers, listingIdsForTier, listingIdsForBinTier } from './sale-tiers';
import { syncSaleStatuses } from './sale-sync';
import { promotionDescription, promotionText, renewalStart } from './promotion-utils';
import { sellApi, SellApiError } from './sell-api';
import { enqueueSaleAnnouncement } from './sale-announcements';

const DAY = 86_400_000;
type Summary = { salesCreated: number; skipped: string[]; errors: string[]; completedAt?: string };
type Sale = typeof ebaySales.$inferSelect;

export async function maintainSales(options: { announce?: boolean } = {}): Promise<Summary> {
  const owner = randomUUID();
  const summary: Summary = { salesCreated: 0, skipped: [], errors: [] };
  // Durable lease protects Vercel retries and concurrent manual runs. Longer than maxDuration.
  const lease = await db.execute(sql`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES ('ebaySalesLease', ${JSON.stringify({ owner })}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    WHERE app_settings.updated_at < now() - interval '10 minutes'
    RETURNING key`);
  if (!lease.rows.length) return { ...summary, skipped: ['Another maintenance run is in progress.'] };
  try {
    const sync = await syncSaleStatuses();
    if (sync.unresolvedCurrent.length) throw new Error('Unreconciled current automatic promotions; refusing to create possible duplicates.');
    const [age, bins, rows] = await Promise.all([getTiers(), getBinTiers(), db.select().from(ebaySales)]);
    const now = new Date();
    const claimed = new Set<string>();
    // Preserve old live/scheduled membership too: changing age buckets must not put
    // a listing into a bin sale while its preceding age sale is still running.
    for (const row of rows) {
      if (row.endsAt > now && ['RUNNING', 'SCHEDULED'].includes(row.status) && row.scope.autoTierKey && !row.scope.autoTierKey.startsWith('bin:') && !row.scope.autoTierKey.startsWith('wizard:')) {
        row.scope.listingIds?.forEach(id => claimed.add(id));
      }
    }
    const tiers: { key: string; name: string; discount: number; ids: string[] }[] = [];
    for (const tier of age.filter(t => t.enabled)) {
      const ids = await listingIdsForTier(tier, age, now);
      ids.forEach(id => claimed.add(id));
      tiers.push({ key: tier.key, name: `Vault find ${tier.discountPercent}% off (${Math.round(tier.minAgeDays / 30)}+ months)`, discount: tier.discountPercent, ids });
    }
    for (const tier of bins.filter(t => t.enabled)) {
      const range = tier.maxBin === null ? `bins ${tier.minBin}+` : `bins ${tier.minBin}–${tier.maxBin}`;
      tiers.push({ key: `bin:${tier.key}`, name: `Back room ${tier.discountPercent}% off (${range})`, discount: tier.discountPercent, ids: await listingIdsForBinTier(tier, claimed) });
    }
    for (const tier of tiers) {
      const relevant = rows.filter(r => r.scope.autoTierKey === tier.key);
      // Resume a partially created cycle using its persisted original chunks.
      const pending = relevant.filter(r => r.endsAt > now && ['DRAFT', 'FAILED'].includes(r.status));
      if (pending.length) {
        for (const row of pending) {
          // Network failures are ambiguous: eBay may have accepted the request.
          if (row.lastError && /timeout|timed out|no promotion ID|fetch failed|HTTP 5\d\d/i.test(row.lastError)) {
            summary.errors.push(`${tier.key}: ambiguous previous creation; review eBay before retrying.`);
          } else {
            await createSale(row, summary);
          }
        }
        continue;
      }
      const live = relevant.filter(r => r.ebayPromotionId && ['SCHEDULED', 'RUNNING'].includes(r.status) && r.endsAt > now);
      const latestEnd = live.length ? new Date(Math.max(...live.map(r => +r.endsAt))) : undefined;
      if (latestEnd && +latestEnd > +now + 3 * DAY) {
        summary.skipped.push(`${tier.key}: sale already has more than three days remaining`);
        continue;
      }
      if (!tier.ids.length) {
        summary.skipped.push(`${tier.key}: no eligible listings`);
        continue;
      }
      let startsAt = renewalStart(now, latestEnd);
      // Wait for other automatic tiers holding these same listings to end.
      // This also handles listings moving into an older tier between cycles.
      const ids = new Set(tier.ids);
      for (const row of rows) {
        if (row.scope.autoTierKey && row.scope.autoTierKey !== tier.key && row.endsAt > startsAt && ['SCHEDULED', 'RUNNING'].includes(row.status) && row.scope.listingIds?.some(id => ids.has(id))) startsAt = row.endsAt;
      }
      const endsAt = new Date(+startsAt + 30 * DAY);
      const count = Math.ceil(tier.ids.length / 500);
      // Persist the complete plan before making any external calls. A timeout
      // cannot leave an unrecorded tail of missing promotion chunks.
      const planned = await db.insert(ebaySales).values(Array.from({ length: count }, (_, part) => ({
        saleType: 'MARKDOWN_SKU' as const,
        status: 'DRAFT' as const,
        name: promotionText(count > 1 ? `${tier.name} (part ${part + 1})` : tier.name, 90),
        description: `Auto tier ${tier.key}`,
        discountPercent: String(tier.discount),
        scope: { autoTierKey: tier.key, listingIds: tier.ids.slice(part * 500, (part + 1) * 500) },
        startsAt,
        endsAt,
      }))).returning();
      const errorsBefore = summary.errors.length;
      for (const row of planned) {
        rows.push(row);
        await createSale(row, summary);
      }
      // Preserve the existing scheduled announcement workflow. Manual recovery
      // can explicitly omit announcements without altering normal cron behavior.
      if (options.announce !== false && summary.errors.length === errorsBefore) {
        try {
          await enqueueSaleAnnouncement({ tierKey: tier.key, saleName: tier.name, discountPercent: tier.discount, listingCount: tier.ids.length, startsAt });
        } catch {
          summary.errors.push(`${tier.key}: sale created but announcement could not be queued.`);
        }
      }
    }
  } catch (err) {
    summary.errors.push(err instanceof Error ? err.message : 'Maintenance failed');
  } finally {
    summary.completedAt = new Date().toISOString();
    await db.insert(appSettings).values({ key: 'ebaySalesMaintenance', value: summary, updatedAt: new Date() })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: summary, updatedAt: new Date() } });
    await db.insert(ebaySaleAuditLog).values({ action: 'maintenance', success: summary.errors.length === 0, details: summary });
    await db.delete(appSettings).where(sql`${appSettings.key} = 'ebaySalesLease' AND ${appSettings.value}->>'owner' = ${owner}`);
  }
  return summary;
}

async function createSale(row: Sale, summary: Summary) {
  // eBay needs a future start. For an unsent plan, preserve its 30-day duration.
  const startsAt = row.startsAt > new Date(Date.now() + 60_000) ? row.startsAt : renewalStart(new Date());
  const endsAt = new Date(+startsAt + (+row.endsAt - +row.startsAt));
  try {
    // Mark attempts before the request: a killed invocation must be treated as
    // uncertain, not blindly re-posted next time.
    await db.update(ebaySales).set({ startsAt, endsAt, lastError: 'Creation outcome unknown (timeout possible); reconcile before retrying.', updatedAt: new Date() }).where(eq(ebaySales.id, row.id));
    const response = await sellApi<{ promotionId: string }>('/sell/marketing/v1/item_price_markdown', {
      method: 'POST',
      body: {
        name: row.name,
        description: promotionDescription(row.name),
        marketplaceId: 'EBAY_US', promotionStatus: 'SCHEDULED',
        startDate: startsAt.toISOString(), endDate: endsAt.toISOString(),
        promotionImageUrl: process.env.EBAY_PROMOTION_IMAGE_URL || 'https://www.foundinalabama.com/photos/bookshelf.jpg',
        selectedInventoryDiscounts: [{
          inventoryCriterion: { inventoryCriterionType: 'INVENTORY_BY_VALUE', listingIds: row.scope.listingIds },
          discountBenefit: { percentageOffItem: String(Math.round(Number(row.discountPercent))) },
        }],
      },
    });
    await db.update(ebaySales).set({ status: 'SCHEDULED', ebayPromotionId: response.promotionId, lastError: null, updatedAt: new Date() }).where(eq(ebaySales.id, row.id));
    await db.insert(ebaySaleAuditLog).values({ saleId: row.id, action: 'auto-create', success: true, details: { tier: row.scope.autoTierKey, promotionId: response.promotionId, listingCount: row.scope.listingIds?.length } });
    summary.salesCreated++;
  } catch (err) {
    const message = err instanceof SellApiError ? `Sell API HTTP ${err.status}: ${err.body.slice(0, 600)}` : err instanceof Error ? err.message : 'Unknown creation failure';
    await db.update(ebaySales).set({ status: 'FAILED', lastError: message.slice(0, 1000), updatedAt: new Date() }).where(eq(ebaySales.id, row.id));
    await db.insert(ebaySaleAuditLog).values({ saleId: row.id, action: 'auto-create', success: false, errorMessage: message.slice(0, 1000) });
    summary.errors.push(`${row.name}: ${message}`);
  }
}
