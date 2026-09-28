import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { syncSaleStatuses } from '@/lib/ebay/sale-sync';
import { checkSaleHealth, notifySaleHealth } from '@/lib/ebay/sale-health';
import { SellApiError } from '@/lib/ebay/sell-api';

/** Short, stable description for the alert email (stable so the 24h dedupe still works). */
function describeError(err: unknown): string {
  if (err instanceof SellApiError) {
    let detail = '';
    try {
      const e = JSON.parse(err.body)?.errors?.[0];
      if (e) detail = ` — ${e.message ?? ''}${e.errorId ? ` (errorId ${e.errorId})` : ''}`;
    } catch {
      detail = err.body ? ` — ${err.body.slice(0, 200)}` : '';
    }
    return `eBay HTTP ${err.status}${detail}`.slice(0, 300);
  }
  return (err instanceof Error ? err.message : String(err)).slice(0, 300);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!(secret && req.headers.get('authorization') === `Bearer ${secret}`) && !(await auth())?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const errors: string[] = [];
  try {
    const sync = await syncSaleStatuses();
    if (sync.unresolvedCurrent.length) errors.push('Some current automatic promotions could not be reconciled with eBay.');
  } catch (err) {
    console.error('[ebay-sales-health] status sync failed', err);
    errors.push(`Status synchronization with eBay failed. Check the eBay connection. Details: ${describeError(err)}`);
  }
  try {
    const health = await checkSaleHealth(errors);
    const notificationSent = await notifySaleHealth(health);
    return NextResponse.json({ ...health, notificationSent }, { status: health.issues.length ? 503 : 200 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Health check failed' }, { status: 500 });
  }
}
