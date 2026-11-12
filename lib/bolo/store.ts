// BOLO items added from a photo (bolo_items, migration 0054). One photo in:
// it's normalized with sharp, kept in R2 as the card's thumbnail, and sent
// to the premium listing-writer model with web search, which identifies the
// product, checks whether it's discontinued and finds eBay comps. The reply
// is saved as a row and shows up on /admin/bolo next to the seed list.

import { randomUUID } from "crypto";
import sharp from "sharp";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { gatewayChat } from "@/lib/gateway";
import { computeLlmCost, getRate, logAiCall } from "@/lib/enhance/cost";
import { writerSettings } from "@/lib/listings/writer";
import { putObject, publicUrl, r2Config } from "@/lib/storage/r2";
import type { BoloItem } from "./discontinued";
import { BOLO_IDENTIFY_SYSTEM, boloUserText, parseBoloReply, type BoloStatus } from "./identify";

type Row = Record<string, unknown>;
async function rows(q: ReturnType<typeof sql>): Promise<Row[]> {
  const res = (await db.execute(q)) as { rows?: Row[] };
  return res.rows ?? [];
}

export type BoloSaved = BoloItem & {
  added: true;
  photo: string | null;
  status: BoloStatus | null;
  confidence: number | null;
  createdAt: string;
};

export async function boloReady(): Promise<boolean> {
  const [r] = await rows(sql`SELECT to_regclass('public.bolo_items') IS NOT NULL AS ok`);
  return !!r?.ok;
}

function toItem(r: Row): BoloSaved {
  return {
    id: String(r.id),
    name: String(r.name),
    category: String(r.category) as BoloItem["category"],
    query: String(r.query),
    comp: String(r.comp),
    kind: String(r.kind) as BoloItem["kind"],
    note: r.note ? String(r.note) : undefined,
    source: r.source ? String(r.source) : undefined,
    added: true,
    photo: r.photo_url ? String(r.photo_url) : null,
    status: r.status ? (String(r.status) as BoloStatus) : null,
    confidence: r.confidence == null ? null : Number(r.confidence),
    createdAt: new Date(String(r.created_at)).toISOString(),
  };
}

/** Saved items, newest first. Empty if the migration hasn't run yet. */
export async function listBoloItems(): Promise<BoloSaved[]> {
  if (!(await boloReady())) return [];
  const r = await rows(sql`SELECT * FROM bolo_items WHERE hidden = false ORDER BY created_at DESC LIMIT 500`);
  return r.map(toItem);
}

export async function hideBoloItem(id: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Unknown item");
  await db.execute(sql`UPDATE bolo_items SET hidden = true WHERE id = ${id}`);
}

const MAX_BYTES = 12 * 1024 * 1024;

export async function addBoloFromPhoto(input: {
  photo: Uint8Array;
  hint: string | null;
  who: string;
}): Promise<BoloSaved> {
  if (!(await boloReady())) throw new Error("Run the migration first (npm run db:migrate).");
  if (!input.photo.byteLength) throw new Error("No photo received.");
  if (input.photo.byteLength > MAX_BYTES) throw new Error("That photo is too large.");

  // Respect the phone's EXIF rotation, cap the size, and re-encode as JPEG
  // (also turns HEIC/PNG/WebP into something every model and browser reads).
  let jpeg: Buffer;
  try {
    jpeg = await sharp(input.photo)
      .rotate()
      .resize({ width: 1568, height: 1568, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
  } catch {
    throw new Error("Couldn't read that image. Try a JPEG or PNG.");
  }

  const id = randomUUID();
  const hint = (input.hint ?? "").trim().slice(0, 500) || null;

  // Thumbnail in R2 (optional — the entry still works without it).
  let photoUrl: string | null = null;
  const r2 = r2Config();
  if (r2) {
    const key = `bolo/${id}.jpg`;
    try {
      await putObject(r2, key, jpeg, "image/jpeg");
      photoUrl = publicUrl(r2, key);
    } catch (err) {
      console.warn(`[bolo] R2 upload failed: ${(err as Error).message}`);
    }
  }

  const model = (await writerSettings()).models.premium;
  const provider = model.split("/")[0] || "gateway";
  const started = Date.now();
  let r: Awaited<ReturnType<typeof gatewayChat>>;
  try {
    r = await gatewayChat({
      model,
      app: "bolo",
      system: BOLO_IDENTIFY_SYSTEM,
      content: [
        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${jpeg.toString("base64")}` } },
        { type: "text", text: boloUserText(hint) },
      ],
      maxTokens: 4000,
      extra: { plugins: [{ id: "web", max_results: 6 }] },
    });
  } catch (err) {
    await logAiCall({ op: "bolo_identify", category: "llm", provider, model, costUsd: 0, durationMs: Date.now() - started, success: false });
    throw new Error(`The AI lookup failed: ${(err as Error).message}`);
  }
  let costUsd = r.usage.costUsd;
  if (costUsd == null) costUsd = computeLlmCost(await getRate(provider, model), r.usage);
  await logAiCall({ op: "bolo_identify", category: "llm", provider, model, usage: r.usage, costUsd, durationMs: Date.now() - started, success: true });

  const parsed = parseBoloReply(r.text);
  if (!parsed) throw new Error("The AI reply couldn't be read. Try again, or add a note with the product name.");

  const aiMeta = { model: r.model || model, costUsd: Math.round(costUsd * 10000) / 10000, raw: r.text.slice(0, 4000) };
  const [saved] = await rows(sql`
    INSERT INTO bolo_items (id, name, category, query, comp, kind, note, source, photo_url, status, confidence, hint, ai_meta, created_by)
    VALUES (${id}, ${parsed.name}, ${parsed.category}, ${parsed.query}, ${parsed.comp}, ${parsed.kind},
            ${parsed.note ?? null}, ${parsed.source ?? null}, ${photoUrl}, ${parsed.status}, ${parsed.confidence},
            ${hint}, ${JSON.stringify(aiMeta)}::jsonb, ${input.who})
    RETURNING *`);
  return toItem(saved);
}
