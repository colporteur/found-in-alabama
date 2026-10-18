// Rotate a draft photo (draft page ↺ / ↻). The rotation is baked into a new
// copy in photo storage, so the writer, Claude, Nifty and the venues all get
// the turned photo. The first upload is never changed or deleted
// (original_url keeps it), and turning back to 0° points at it again.

import { db } from "@/db";
import { sql } from "drizzle-orm";
import sharp from "sharp";
import { putObject, publicUrl, r2Config } from "@/lib/storage/r2";

type Row = Record<string, unknown>;
async function rows(q: ReturnType<typeof sql>): Promise<Row[]> {
  const res = (await db.execute(q)) as { rows?: Row[] };
  return res.rows ?? [];
}

/** Statuses whose photos can still change (not yet in Nifty or live). */
export const ROTATABLE = ["ready", "review", "sent_back", "with_claude", "approved", "lot_open"];

export function nextRotation(current: number, delta: number): number {
  return (((current + delta) % 360) + 360) % 360;
}

export async function rotatePhoto(draftId: string, position: number, delta: 90 | -90 | 180): Promise<{ url: string; rotation: number }> {
  const cfg = r2Config();
  if (!cfg) throw new Error("Photo storage (R2) is not configured");
  const [col] = await rows(sql`
    SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'draft_photos' AND column_name = 'rotation') AS ok`);
  if (!col?.ok) throw new Error("Run npm run db:migrate first (migration 0043).");
  const [p] = await rows(sql`
    SELECT p.id, p.url, p.rotation, p.original_url, p.uploaded_at, d.status
    FROM draft_photos p JOIN listing_drafts d ON d.id = p.draft_id
    WHERE p.draft_id = ${draftId}::uuid AND p.position = ${position}`);
  if (!p) throw new Error("No such photo");
  if (!p.uploaded_at) throw new Error("That photo hasn't finished uploading");
  if (!ROTATABLE.includes(String(p.status)))
    throw new Error(`Photos can't be turned once a draft is "${String(p.status).replace("_", " ")}"`);

  const original = String(p.original_url ?? p.url);
  const rotation = nextRotation(Number(p.rotation ?? 0), delta);
  let url = original;
  if (rotation !== 0) {
    const res = await fetch(original, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`Couldn't read the photo (HTTP ${res.status})`);
    const buf = Buffer.from(await res.arrayBuffer());
    // Two passes: sharp applies only one rotate per pipeline, so first the
    // camera's EXIF orientation, then Todd's turn.
    const upright = await sharp(buf, { failOn: "none" }).rotate().toBuffer();
    const out = await sharp(upright).rotate(rotation).jpeg({ quality: 90 }).toBuffer();
    const key = `drafts/${draftId}/rotated/${String(p.id)}-r${rotation}-${Date.now().toString(36)}.jpg`;
    await putObject(cfg, key, out, "image/jpeg");
    url = publicUrl(cfg, key);
  }
  await db.execute(sql`
    UPDATE draft_photos SET url = ${url}, rotation = ${rotation}, original_url = ${original}
    WHERE id = ${String(p.id)}::uuid`);
  await db.execute(sql`UPDATE listing_drafts SET updated_at = now() WHERE id = ${draftId}::uuid`);
  return { url, rotation };
}
