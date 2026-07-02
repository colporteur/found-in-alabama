// GET /api/admin/enhance/backfill-last-actions — one-time backfill of
// ebay_listings.last_wiggle_at / last_substantive_at from the enhance_jobs
// history accumulated before the columns existed. Idempotent — safe to
// run again any time (it recomputes from completed jobs).

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(_req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const wiggle = await db.execute(sql`
    UPDATE ebay_listings el
    SET last_wiggle_at = sub.max_completed
    FROM (
      SELECT j.ebay_item_id, max(j.completed_at) AS max_completed
      FROM enhance_jobs j
      JOIN enhance_batches b ON j.batch_id = b.id
      WHERE j.status = 'completed'
        AND b.op IN ('price_adjust', 'sku_rename')
      GROUP BY j.ebay_item_id
    ) sub
    WHERE el.item_id = sub.ebay_item_id
  `);

  const substantive = await db.execute(sql`
    UPDATE ebay_listings el
    SET last_substantive_at = sub.max_completed
    FROM (
      SELECT j.ebay_item_id, max(j.completed_at) AS max_completed
      FROM enhance_jobs j
      JOIN enhance_batches b ON j.batch_id = b.id
      WHERE j.status = 'completed'
        AND b.op IN ('item_specifics', 'title_remix', 'description_remix', 'price_research')
      GROUP BY j.ebay_item_id
    ) sub
    WHERE el.item_id = sub.ebay_item_id
  `);

  return NextResponse.json({
    ok: true,
    wiggleRowsUpdated: wiggle.rowCount ?? 0,
    substantiveRowsUpdated: substantive.rowCount ?? 0,
  });
}
