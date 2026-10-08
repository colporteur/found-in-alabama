// Request validation for listing intake (Phase LIST-1). Pure, no imports,
// so it's unit-tested in isolation (lib/listings/validate.test.mts).

export const INTAKE_SOURCES = ["scans", "scanroom", "photoxfer", "estate", "manual"] as const;
export type IntakeSource = (typeof INTAKE_SOURCES)[number];

export const PHOTO_ROLES = ["cover", "front", "back", "inside", "detail", "other"] as const;

export const MAX_PHOTOS = 24; // Nifty's per-item cap; eBay allows 24 too
export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;

const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/tiff", "image/heic"]);

export type IntakePhoto = {
  name: string;
  sha256: string;
  bytes: number;
  contentType: string;
  role: string | null;
};

export type IntakeRequest = {
  source: IntakeSource;
  sourceRef: string | null;
  sourceLabel: string | null;
  titleHint: string | null;
  notes: string | null;
  binSku: string | null;
  weightOz: number | null;
  quantity: number;
  facts: Record<string, unknown>;
  photos: IntakePhoto[];
  /** presigned = uploader PUTs to storage itself (PC sender);
   *  proxy = uploader posts each photo to the app (browser). */
  uploadMode: "presigned" | "proxy";
  /** Re-send of an existing source item: replace its photos (only while it
   *  hasn't been written yet). */
  replace: boolean;
};

function str(v: unknown, max: number): string | null {
  if (v == null) return null;
  if (typeof v !== "string") throw new Error("expected text");
  const t = v.trim();
  if (!t) return null;
  if (t.length > max) throw new Error(`text longer than ${max} characters`);
  return t;
}

function num(v: unknown, min: number, max: number): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`number out of range ${min}–${max}`);
  return n;
}

export type Parsed = { ok: true; value: IntakeRequest } | { ok: false; error: string };

export function parseIntakeRequest(body: unknown): Parsed {
  try {
    if (!body || typeof body !== "object") throw new Error("JSON object expected");
    const b = body as Record<string, unknown>;

    const source = b.source;
    if (typeof source !== "string" || !(INTAKE_SOURCES as readonly string[]).includes(source)) {
      throw new Error(`source must be one of ${INTAKE_SOURCES.join(", ")}`);
    }

    if (!Array.isArray(b.photos) || b.photos.length === 0) throw new Error("at least one photo is required");
    if (b.photos.length > MAX_PHOTOS) throw new Error(`at most ${MAX_PHOTOS} photos per item`);
    const seen = new Set<string>();
    const photos: IntakePhoto[] = b.photos.map((p, i) => {
      if (!p || typeof p !== "object") throw new Error(`photo ${i + 1}: object expected`);
      const r = p as Record<string, unknown>;
      const sha = typeof r.sha256 === "string" ? r.sha256.toLowerCase() : "";
      if (!/^[0-9a-f]{64}$/.test(sha)) throw new Error(`photo ${i + 1}: sha256 must be 64 hex characters`);
      if (seen.has(sha)) throw new Error(`photo ${i + 1}: same file listed twice`);
      seen.add(sha);
      const ct = typeof r.contentType === "string" ? r.contentType.toLowerCase() : "";
      if (!PHOTO_TYPES.has(ct)) throw new Error(`photo ${i + 1}: unsupported type ${ct || "(none)"}`);
      const bytes = num(r.bytes, 1, MAX_PHOTO_BYTES);
      if (bytes == null) throw new Error(`photo ${i + 1}: bytes required`);
      const role = str(r.role, 20);
      return {
        name: str(r.name, 200) ?? `photo-${i + 1}`,
        sha256: sha,
        bytes,
        contentType: ct,
        role: role && (PHOTO_ROLES as readonly string[]).includes(role) ? role : null,
      };
    });

    const facts = b.facts && typeof b.facts === "object" && !Array.isArray(b.facts) ? (b.facts as Record<string, unknown>) : {};
    if (JSON.stringify(facts).length > 8000) throw new Error("facts too large");

    const quantity = num(b.quantity, 1, 999) ?? 1;
    return {
      ok: true,
      value: {
        source: source as IntakeSource,
        sourceRef: str(b.sourceRef, 500),
        sourceLabel: str(b.sourceLabel, 300),
        titleHint: str(b.titleHint, 300),
        notes: str(b.notes, 4000),
        binSku: str(b.binSku, 120),
        weightOz: num(b.weightOz, 0, 100000),
        quantity: Math.round(quantity),
        facts,
        photos,
        uploadMode: b.uploadMode === "proxy" ? "proxy" : "presigned",
        replace: b.replace === true,
      },
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Photo role from a Scanroom-style filename (00-cover, 01-front,
 *  02-inside-01, NN-back). */
export function roleFromName(name: string): string | null {
  const m = name.toLowerCase().match(/(?:^|[-_ .\d])(cover|front|back|inside)(?=[-_ .\d]|$)/);
  return m ? m[1] : null;
}
