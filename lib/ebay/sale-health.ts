import { db } from '@/db';
import { appSettings, ebaySales } from '@/db/schema';
import { eq, gt } from 'drizzle-orm';
import { getTiers, getBinTiers, listingIdsForTier, listingIdsForBinTier } from './sale-tiers';
import { sendAdminEmail, esc } from '@/lib/hip/notify';

export const SALES_HEALTH_KEY = 'ebaySalesHealth';
export type SalesHealth = { checkedAt: string; issues: string[]; activeTiers: number; eligibleTiers: number; notificationSent?: boolean };

export async function checkSaleHealth(extraIssues: string[] = []): Promise<SalesHealth> {
  const now = new Date();
  const [age, bins, sales] = await Promise.all([
    getTiers(), getBinTiers(), db.select().from(ebaySales).where(gt(ebaySales.endsAt, now)),
  ]);
  const issues = [...extraIssues];
  if (!process.env.ADMIN_EMAIL || !process.env.AUTH_EMAIL_FROM || !(process.env.AUTH_RESEND_KEY || process.env.RESEND_API_KEY)) issues.push('Admin email alerts are not fully configured.');
  const claimed = new Set<string>();
  let activeTiers = 0, eligibleTiers = 0;
  function check(key: string, eligible: number) {
    if (!eligible) return;
    eligibleTiers++;
    const matching = sales.filter(s => s.scope.autoTierKey === key && s.ebayPromotionId);
    const live = matching.filter(s => s.status === 'RUNNING' && s.startsAt <= now && s.endsAt > now);
    const interrupted = sales.filter(s => s.scope.autoTierKey === key && s.startsAt <= now && !['RUNNING', 'SCHEDULED'].includes(s.status));
    if (interrupted.length) issues.push(`${key}: ${interrupted.length} sale part(s) failed, paused, or ended before their planned end. Review coverage in eBay.`);
    if (live.length) {
      activeTiers++;
      return;
    }
    const next = matching.filter(s => s.status === 'SCHEDULED' && s.startsAt > now && s.endsAt > s.startsAt).sort((a,b) => +a.startsAt - +b.startsAt)[0];
    issues.push(`${key}: ${eligible} eligible listings but no active sale${next ? `; next starts ${next.startsAt.toISOString()}` : ' or scheduled replacement'}.`);
  }
  for (const tier of age.filter(t => t.enabled)) {
    const ids = await listingIdsForTier(tier, age, now);
    ids.forEach(id => claimed.add(id));
    check(tier.key, ids.length);
  }
  for (const tier of bins.filter(t => t.enabled)) check(`bin:${tier.key}`, (await listingIdsForBinTier(tier, claimed)).length);
  const [maintenance] = await db.select().from(appSettings).where(eq(appSettings.key, 'ebaySalesMaintenance'));
  const last = maintenance?.value as { completedAt?: string; errors?: string[] } | undefined;
  if (eligibleTiers && (!last?.completedAt || now.getTime() - Date.parse(last.completedAt) > 30 * 3600_000)) {
    issues.push('Automatic sales maintenance has not completed successfully in the last 30 hours.');
  }
  if (last?.errors?.length) issues.push('The most recent maintenance run reported errors; review Sales & promotions.');
  const health: SalesHealth = { checkedAt: now.toISOString(), issues, activeTiers, eligibleTiers };
  await db.insert(appSettings).values({ key: SALES_HEALTH_KEY, value: health, updatedAt: now })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: health, updatedAt: now } });
  return health;
}

/** Only email when unhealthy; deduplicate unchanged issues for 24 hours. */
export async function notifySaleHealth(health: SalesHealth) {
  if (!health.issues.length) return false;
  const key = 'ebaySalesHealthLastAlert';
  const [previous] = await db.select().from(appSettings).where(eq(appSettings.key, key));
  const prev = previous?.value as { fingerprint?: string; sentAt?: string } | undefined;
  const fingerprint = health.issues.join('\n');
  if (prev?.fingerprint === fingerprint && prev.sentAt && Date.now() - Date.parse(prev.sentAt) < 86_400_000) return false;
  const sent = await sendAdminEmail('Action needed: eBay automatic sales',
    `<p>Your automatic eBay sales need attention.</p><ul>${health.issues.map(i => `<li>${esc(i)}</li>`).join('')}</ul><p><a href="https://www.foundinalabama.com/admin/ebay/sales">Review Sales &amp; promotions</a></p>`);
  if (!sent) throw new Error('Sales alert email could not be delivered; check admin email configuration.');
  await db.insert(appSettings).values({ key, value: { fingerprint, sentAt: health.checkedAt }, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: { fingerprint, sentAt: health.checkedAt }, updatedAt: new Date() } });
  return true;
}
