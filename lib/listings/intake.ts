// Listing intake (Phase LIST-1): create a draft + registry item for an item
// sent from the PC or the manual lister, hand back upload instructions, and
// confirm uploads. Writes only listing_drafts, draft_photos and a new
// registry_items row (status 'draft'). Nothing is published anywhere.

import { db } from "@/db";
import { sql } from "drizzle-orm";
import type { IntakeRequest } from "./validate";
import { draftPhotoKey, headObject, presignPut, publicUrl, r2Config, type R2Config } from "@/lib/storage/r2";

type Row = Record<string, unknown>;

async function rows(q: ReturnType<typeof sql>): Promise<Row[]> {
  const res = (await db.execute(q)) as { rows?: Row[] };
  return res.rows ?? [];
}

export type UploadInstruction = {
  position: number;
  name: string;
  key: string;
  /** Presigned PUT URL (presigned mode) or the app route to POST to (proxy mode). */
  url: string;
  method: "PUT" | "POST";
  contentType: string;
};

export type IntakeResult =
  | {
      ok: true;
      draftId: string;
      registryItemId: string | null;
      status: string;
      existing: boolean;
      uploads: UploadInstruction[];
    }
  | { ok: false; status: number; error: string };

function normalize(t: string): string {
  return t.toLowerCase().replace(/\s+/g, " ").trim();
}

async function uploadsFor(cfg: R2Config, draftId: string, mode: "presigned" | "proxy"): Promise<UploadInstruction[]> {
  const pending = await rows(sql`
    SELECT position, original_name, storage_key, content_type FROM draft_photos
    WHERE draft_id = ${draftId} AND uploaded_at IS NULL ORDER BY position`);
  const out: UploadInstruction[] = [];
  for (const p of pending) {
    const key = String(p.storage_key);
    const contentType = String(p.content_type);
    out.push({
      position: Number(p.position),
      name: String(p.original_name ?? ""),
      key,
      contentType,
      method: mode === "presigned" ? "PUT" : "POST",
      url:
        mode === "presigned"
          ? await presignPut(cfg, key, contentType)
          : `/api/admin/listings/${draftId}/photo?position=${Number(p.position)}`,
    });
  }
  return out;
}

async function insertPhotos(cfg: R2Config, draftId: string, req: IntakeRequest) {
  for (let i = 0; i < req.photos.length; i++) {
    const p = req.photos[i];
    const position = i + 1;
    const key = draftPhotoKey(draftId, position, p.sha256, p.contentType);
    await db.execute(sql`
      INSERT INTO draft_photos (draft_id, position, role, storage_key, url, original_name, sha256, bytes, content_type)
      VALUES (${draftId}, ${position}, ${p.role}, ${key}, ${publicUrl(cfg, key)}, ${p.name}, ${p.sha256},
              ${p.bytes}, ${p.contentType})`);
  }
}

/** Keep the sender's "after upload" wish on the draft until the photos are in. */
async function rememberAfter(draftId: string, req: IntakeRequest): Promise<void> {
  if (req.folderLot) {
    // Laid out as a lot (overview, solos, grid) once every photo is in.
    await db.execute(sql`
      UPDATE listing_drafts SET quantity = 1, ai_meta = COALESCE(ai_meta, '{}'::jsonb) || '{"folderLotPending": true}'::jsonb
      WHERE id = ${draftId} AND NOT (COALESCE(ai_meta, '{}'::jsonb) ? 'folderLot')`);
  }
  if (!req.after.claude && !req.after.pool) return;
  await db.execute(sql`
    UPDATE listing_drafts SET ai_meta = COALESCE(ai_meta, '{}'::jsonb) || jsonb_build_object('intakeAfter', ${JSON.stringify(req.after)}::jsonb)
    WHERE id = ${draftId}`);
}

export async function startIntake(req: IntakeRequest, who: string): Promise<IntakeResult> {
  const cfg = r2Config();
  if (!cfg) return { ok: false, status: 503, error: "Photo storage (R2) is not configured yet" };

  // Re-send of a source item already received?
  if (req.sourceRef) {
    const [existing] = await rows(sql`
      SELECT id, registry_item_id, status FROM listing_drafts
      WHERE source = ${req.source} AND source_ref = ${req.sourceRef} AND status <> 'discarded'
      LIMIT 1`);
    if (existing) {
      const draftId = String(existing.id);
      const status = String(existing.status);
      // FIA-made covers (and a folder lot's grid) aren't the sender's photos.
      const known = (
        await rows(sql`SELECT sha256 FROM draft_photos WHERE draft_id = ${draftId} AND storage_key NOT LIKE '%/cover/%' ORDER BY position`)
      ).map((r) => String(r.sha256));
      const sent = req.photos.map((p) => p.sha256);
      // A folder lot's photos are rearranged once it's laid out, so only the set matters.
      const same =
        known.length === sent.length &&
        (req.folderLot ? sent.every((s) => known.includes(s)) : known.every((s, i) => s === sent[i]));
      if (!same) {
        if (!req.replace) {
          return {
            ok: false,
            status: 409,
            error: "This item was already sent with different photos. Send again with “replace” to update it.",
          };
        }
        if (!["uploading", "ready"].includes(status)) {
          return { ok: false, status: 409, error: `Already ${status}; its photos can't be replaced from here` };
        }
        await db.execute(sql`DELETE FROM draft_photos WHERE draft_id = ${draftId}`);
        await insertPhotos(cfg, draftId, req);
        await db.execute(sql`UPDATE listing_drafts SET status = 'uploading', updated_at = now(),
          ai_meta = (COALESCE(ai_meta, '{}'::jsonb) - 'folderLot') - 'folderLotError' WHERE id = ${draftId}`);
      }
      await rememberAfter(draftId, req);
      return {
        ok: true,
        draftId,
        registryItemId: existing.registry_item_id ? String(existing.registry_item_id) : null,
        status: same ? status : "uploading",
        existing: true,
        uploads: await uploadsFor(cfg, draftId, req.uploadMode),
      };
    }
  }

  const title = req.titleHint ?? "Untitled item";
  const [item] = await rows(sql`
    INSERT INTO registry_items (status, title, title_normalized, bin_sku, created_from)
    VALUES ('draft', ${title}, ${normalize(title)}, ${req.binSku}, 'intake')
    RETURNING id`);
  const registryItemId = String(item.id);

  let draftId: string;
  try {
    const [draft] = await rows(sql`
      INSERT INTO listing_drafts (registry_item_id, status, source, source_ref, source_label, facts, notes,
                                  title_hint, bin_sku, weight_oz, quantity, created_by)
      VALUES (${registryItemId}, 'uploading', ${req.source}, ${req.sourceRef}, ${req.sourceLabel},
              ${JSON.stringify(req.facts)}::jsonb, ${req.notes}, ${req.titleHint}, ${req.binSku},
              ${req.weightOz}, ${req.quantity}, ${who})
      RETURNING id`);
    draftId = String(draft.id);
    await insertPhotos(cfg, draftId, req);
    await rememberAfter(draftId, req);
  } catch (err) {
    // Don't leave an orphan registry item behind (the draft cascades its photos).
    await db.execute(sql`DELETE FROM listing_drafts WHERE registry_item_id = ${registryItemId}`).catch(() => {});
    await db.execute(sql`DELETE FROM registry_items WHERE id = ${registryItemId} AND status = 'draft'`).catch(() => {});
    throw err;
  }

  return {
    ok: true,
    draftId,
    registryItemId,
    status: "uploading",
    existing: false,
    uploads: await uploadsFor(cfg, draftId, req.uploadMode),
  };
}

/** Confirm uploads by checking storage; a draft whose photos are all there
 *  moves uploading → ready. */
export async function completeIntake(
  draftId: string
): Promise<{ ok: true; status: string; missing: number[] } | { ok: false; status: number; error: string }> {
  const cfg = r2Config();
  if (!cfg) return { ok: false, status: 503, error: "Photo storage (R2) is not configured yet" };
  const [draft] = await rows(sql`SELECT status, ai_meta FROM listing_drafts WHERE id = ${draftId}`);
  if (!draft) return { ok: false, status: 404, error: "Draft not found" };

  const pending = await rows(sql`
    SELECT id, position, storage_key FROM draft_photos WHERE draft_id = ${draftId} AND uploaded_at IS NULL`);
  const missing: number[] = [];
  for (const p of pending) {
    const size = await headObject(cfg, String(p.storage_key));
    if (size == null) {
      missing.push(Number(p.position));
      continue;
    }
    await db.execute(sql`UPDATE draft_photos SET uploaded_at = now(), bytes = ${size} WHERE id = ${String(p.id)}`);
  }
  let status = String(draft.status);
  if (missing.length === 0 && status === "uploading") {
    await db.execute(sql`UPDATE listing_drafts SET status = 'ready', updated_at = now() WHERE id = ${draftId}`);
    status = "ready";
  }
  const meta = (draft.ai_meta as Record<string, unknown> | null) ?? {};
  // Scans page "Send as one lot": lay the lot out before anything else sees it.
  if (missing.length === 0 && meta.folderLotPending === true && status === "ready") {
    try {
      const { arrangeFolderLot } = await import("./folder-lot");
      await arrangeFolderLot(draftId, null, "scans page", { rebuildCover: true });
      await db.execute(sql`UPDATE listing_drafts SET ai_meta = COALESCE(ai_meta, '{}'::jsonb) - 'folderLotPending' WHERE id = ${draftId}`);
    } catch (err) {
      // Stays Ready (not queued anywhere) with the error showing on its page;
      // "Lay out the lot" there tries again.
      console.error("[intake] folder lot layout failed", draftId, err);
      await db.execute(sql`UPDATE listing_drafts SET ai_meta = COALESCE(ai_meta, '{}'::jsonb) || jsonb_build_object('folderLotError', ${(err as Error).message}::text) WHERE id = ${draftId}`);
      return { ok: true, status, missing };
    }
  }
  // Sent from the Scans page with "also send to Claude": queue it now.
  const after = meta.intakeAfter as IntakeRequest["after"] | undefined;
  // Sent from the Scans page's "Lot pool": set it aside in the lot pool.
  if (missing.length === 0 && after?.pool && status === "ready") {
    try {
      const { poolDraft, poolReady } = await import("./pool");
      if (await poolReady()) {
        await poolDraft(draftId, "scans page", { note: "from the Scans page Lot pool folder" });
        await db.execute(sql`UPDATE listing_drafts SET ai_meta = COALESCE(ai_meta, '{}'::jsonb) - 'intakeAfter' WHERE id = ${draftId}`);
        status = "pooled";
      }
    } catch (err) {
      console.error("[intake] lot pool failed", draftId, err);
    }
  }
  if (missing.length === 0 && after?.claude && status === "ready") {
    const c = after.claude;
    const done = await rows(sql`
      UPDATE listing_drafts SET status = 'with_claude', generation_error = NULL, updated_at = now(),
        ai_meta = (COALESCE(ai_meta, '{}'::jsonb) - 'intakeAfter') || jsonb_build_object(
          'claudeQueuedAt', now(), 'claudeQueuedBy', 'scans page',
          'claudeBatch', ${c.batch ?? `scans-${new Date().toISOString().slice(0, 13)}`}::text, 'claudeLots', ${c.lots}::boolean)
      WHERE id = ${draftId} AND status = 'ready' RETURNING id`);
    if (done.length) status = "with_claude";
  }
  return { ok: true, status, missing };
}
