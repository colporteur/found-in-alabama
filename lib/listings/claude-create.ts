// Drafts Claude writes from scratch (listing_create_draft). Todd researches
// an item with Claude in a chat, and Claude puts the finished listing straight
// into his Review queue instead of Todd re-creating it by hand. The draft goes
// through exactly the same cleanup and rules as listing_save (it IS a
// listing_save, on a draft made for it), and arrives with no photos:
// Todd adds them on the draft page ("Add photos"). It is marked "Created by
// Claude", can't be approved until it has a photo, and nothing here approves,
// sends to Nifty or publishes. At most CLAUDE_CREATE_DAILY_CAP a day.

import { db } from "@/db";
import { sql } from "drizzle-orm";
import { CLAUDE_STATUS, saveClaudeWrite, type ClaudeWrite } from "./claude";

type Row = Record<string, unknown>;
async function rows(q: ReturnType<typeof sql>): Promise<Row[]> {
  const res = (await db.execute(q)) as { rows?: Row[] };
  return res.rows ?? [];
}

export const CLAUDE_CREATE_DAILY_CAP = 25;
export const CLAUDE_SOURCE = "claude";

export type CreateExtras = {
  /** Bin/SKU, when Todd has said where it is. */
  bin?: string | null;
  /** Where it came from ("Oxford AL estate sale, Oct 2026"). */
  sourceNote?: string | null;
  /** Where the photos are, so Todd knows what to add ("Batch 02, 10312026–10312026_013 + 3 phone photos"). */
  photoNote?: string | null;
  weightOz?: number | null;
  quantity?: number | null;
};

/** Pure: the extras from the tool's arguments. */
export function createExtras(a: Record<string, unknown>): CreateExtras {
  const s = (k: string, n: number) => (typeof a[k] === "string" ? (a[k] as string).trim().slice(0, n) || null : null);
  const num = (k: string) => (a[k] == null || a[k] === "" ? null : Number(a[k]));
  const w = num("weight_oz");
  const q = num("quantity");
  return {
    bin: s("bin", 60),
    sourceNote: s("source_note", 300),
    photoNote: s("photo_note", 500),
    weightOz: w != null && w > 0 && w <= 2000 ? w : null,
    quantity: q != null && q >= 1 ? Math.min(999, Math.round(q)) : null,
  };
}

const EXTRA_KEYS = ["bin", "source_note", "photo_note", "weight_oz", "quantity"];

export async function claudeCreateDraft(args: Record<string, unknown>, who: string) {
  const title = typeof args.title === "string" ? args.title.trim() : "";
  if (title.length < 10) throw new Error("Send the full listing: title, description, condition and price at least.");
  const [c] = await rows(sql`
    SELECT count(*)::int AS n FROM listing_drafts
    WHERE source = ${CLAUDE_SOURCE} AND created_at > now() - interval '24 hours'`);
  if (Number(c?.n ?? 0) >= CLAUDE_CREATE_DAILY_CAP)
    throw new Error(`Claude has already created ${CLAUDE_CREATE_DAILY_CAP} drafts in the last 24 hours (the daily limit). Ask Todd to review those first.`);

  const x = createExtras(args);
  const listing: ClaudeWrite = Object.fromEntries(Object.entries(args).filter(([k]) => !EXTRA_KEYS.includes(k)));
  const label = `Created by Claude${x.sourceNote ? ` · ${x.sourceNote}` : ""}`.slice(0, 300);
  const meta = { createdByClaude: true, createdByConnection: who, needsPhotos: true, photoNote: x.photoNote };

  const [item] = await rows(sql`
    INSERT INTO registry_items (status, title, title_normalized, bin_sku, created_from)
    VALUES ('draft', ${title}, ${title.toLowerCase().replace(/\s+/g, " ")}, ${x.bin}, 'claude')
    RETURNING id`);
  const registryItemId = String(item.id);
  let draftId: string | null = null;
  try {
    const [d] = await rows(sql`
      INSERT INTO listing_drafts (registry_item_id, status, source, source_label, facts, notes, title_hint, bin_sku,
                                  weight_oz, quantity, created_by, ai_meta)
      VALUES (${registryItemId}, ${CLAUDE_STATUS}, ${CLAUDE_SOURCE}, ${label},
              ${JSON.stringify(x.sourceNote ? { source_note: x.sourceNote } : {})}::jsonb,
              ${x.photoNote ? `Photos: ${x.photoNote}` : null}, ${title}, ${x.bin}, ${x.weightOz}, ${x.quantity ?? 1},
              ${`claude:${who}`}, ${JSON.stringify(meta)}::jsonb)
      RETURNING id`);
    draftId = String(d.id);
    const saved = await saveClaudeWrite(draftId, listing, who);
    // Put "add photos" at the top of the flags Todd sees in Review.
    const first = `Created by Claude from a chat — no photos yet. Add them on this page ("Add photos")${x.photoNote ? `: ${x.photoNote}` : ""}.`;
    await db.execute(sql`
      UPDATE listing_drafts SET ai_meta = jsonb_set(ai_meta, '{flags}',
        to_jsonb(ARRAY[${first}::text]) || COALESCE(ai_meta->'flags', '[]'::jsonb))
      WHERE id = ${draftId}::uuid`);
    return {
      ...saved,
      created: true,
      flags: [first, ...(saved.flags ?? [])],
      note: "In Todd's Review queue, marked Created by Claude. It has no photos: tell Todd to add them on the draft page (it can't be approved without one). Change it with listing_revise.",
    };
  } catch (err) {
    // Leave nothing half-made behind.
    if (draftId) await db.execute(sql`DELETE FROM listing_drafts WHERE id = ${draftId}::uuid`).catch(() => {});
    await db.execute(sql`DELETE FROM registry_items WHERE id = ${registryItemId}::uuid AND status = 'draft'`).catch(() => {});
    throw err;
  }
}
