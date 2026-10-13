// POST /api/admin/listings/pool — the lot pool (lib/listings/pool.ts).
//   { action: "pool_draft", draftId, note?, groupId?, newGroup? }
//   { action: "add_candidate", registryItemId, note?, groupId?, newGroup? }
//   { action: "release", memberId }
//   { action: "assign", memberIds, groupId? | newGroup? }   (neither = take out of its lot)
//   { action: "group", groupId, name?, allowMix?, suggestedPrice?, reason? }
//   { action: "dissolve", groupId }
//   { action: "moved", memberIds }
//   { action: "delisted", memberId, done }
//   { action: "list", groupId }   → builds the lot draft and queues it for Claude
// Signed-in admin only. Nothing is published from here.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  addCandidate,
  assignMembers,
  confirmDelisted,
  dissolveGroup,
  listGroup,
  markMoved,
  poolDraft,
  poolReady,
  releaseMember,
  updateGroup,
} from "@/lib/listings/pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await poolReady())) return NextResponse.json({ error: "Run npm run db:migrate first (migration 0045)." }, { status: 409 });
  const who = session.user.email ?? "admin";
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    switch (b.action) {
      case "pool_draft":
        return NextResponse.json({ ok: true, ...(await poolDraft(String(b.draftId ?? ""), who, { note: s(b.note), groupId: s(b.groupId), newGroup: s(b.newGroup) })) });
      case "add_candidate":
        return NextResponse.json({ ok: true, ...(await addCandidate(String(b.registryItemId ?? ""), who, { note: s(b.note), groupId: s(b.groupId), newGroup: s(b.newGroup) })) });
      case "release":
        return NextResponse.json({ ok: true, ...(await releaseMember(String(b.memberId ?? ""))) });
      case "assign": {
        const target = s(b.groupId) || s(b.newGroup) ? { groupId: s(b.groupId), newGroup: s(b.newGroup) } : null;
        return NextResponse.json({ ok: true, ...(await assignMembers(list(b.memberIds), target, who)) });
      }
      case "group": {
        const price = b.suggestedPrice === null || b.suggestedPrice === "" ? null : Number(b.suggestedPrice);
        await updateGroup(String(b.groupId ?? ""), {
          name: s(b.name) ?? undefined,
          allowMix: typeof b.allowMix === "boolean" ? b.allowMix : undefined,
          suggestedPrice: "suggestedPrice" in b ? (price != null && Number.isFinite(price) && price > 0 ? price : null) : undefined,
          reason: "reason" in b ? s(b.reason) : undefined,
        });
        return NextResponse.json({ ok: true });
      }
      case "dissolve":
        await dissolveGroup(String(b.groupId ?? ""));
        return NextResponse.json({ ok: true });
      case "moved":
        return NextResponse.json({ ok: true, moved: await markMoved(list(b.memberIds)) });
      case "delisted":
        await confirmDelisted(String(b.memberId ?? ""), b.done !== false);
        return NextResponse.json({ ok: true });
      case "list":
        return NextResponse.json({ ok: true, ...(await listGroup(String(b.groupId ?? ""), who)) });
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 409 });
  }
}
