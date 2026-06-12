// POST /api/admin/ebay/sales/wizard
//
// action "preview": { monthStartISO? } → deterministic 4-week plan.
// action "execute": { monthStartISO, discountPercent, offset, limit,
//                     socialPosts } → create that slice of sales on eBay
//   (client drives chunking). Weekly sale-announcement social drafts are
//   enqueued once, on the first chunk, when socialPosts is true.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  buildWizardPlan,
  createWizardSocialDrafts,
  executeWizardChunk,
} from "@/lib/ebay/sale-wizard";

export const runtime = "nodejs";
export const maxDuration = 60;

type WizardBody = {
  action?: "preview" | "execute";
  monthStartISO?: string;
  discountPercent?: number;
  offset?: number;
  limit?: number;
  socialPosts?: boolean;
};

function resolveMonthStart(iso: string | undefined): Date {
  if (iso) {
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) return d;
  }
  // Default: tomorrow at 08:00 UTC (overnight buffer for eBay's clock).
  const t = new Date(Date.now() + 86_400_000);
  return new Date(
    Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), 8, 0, 0)
  );
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: WizardBody;
  try {
    body = (await req.json()) as WizardBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const monthStart = resolveMonthStart(body.monthStartISO);

  try {
    if (body.action === "preview") {
      const plan = await buildWizardPlan(monthStart);
      return NextResponse.json({
        monthStartISO: monthStart.toISOString(),
        plan,
        total: plan.length,
        alreadyCreated: plan.filter((p) => p.alreadyCreated).length,
      });
    }

    if (body.action === "execute") {
      const discountPercent = Number(body.discountPercent) || 20;
      if (discountPercent <= 0 || discountPercent > 80) {
        return NextResponse.json(
          { error: "discountPercent must be 1-80" },
          { status: 400 }
        );
      }
      const offset = Math.max(0, Number(body.offset) || 0);
      const limit = Math.min(10, Math.max(1, Number(body.limit) || 6));

      let socialDraftsCreated = 0;
      if (offset === 0 && body.socialPosts) {
        socialDraftsCreated = await createWizardSocialDrafts(
          monthStart,
          discountPercent
        );
      }

      const result = await executeWizardChunk({
        monthStart,
        discountPercent,
        offset,
        limit,
      });
      return NextResponse.json({ ...result, socialDraftsCreated });
    }

    return NextResponse.json(
      { error: 'action must be "preview" or "execute"' },
      { status: 400 }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Wizard failed" },
      { status: 500 }
    );
  }
}
