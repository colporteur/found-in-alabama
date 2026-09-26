import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { syncSaleStatuses } from '@/lib/ebay/sale-sync';
import { checkSaleHealth, notifySaleHealth } from '@/lib/ebay/sale-health';

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
  } catch {
    errors.push('Status synchronization with eBay failed. Check the eBay connection.');
  }
  try {
    const health = await checkSaleHealth(errors);
    const notificationSent = await notifySaleHealth(health);
    return NextResponse.json({ ...health, notificationSent }, { status: health.issues.length ? 503 : 200 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Health check failed' }, { status: 500 });
  }
}
