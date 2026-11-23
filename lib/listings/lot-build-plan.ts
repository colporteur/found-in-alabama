// Lot Builder — the pure part (no imports, unit-tested in
// lot-build-plan.test.mts): cleaning what Claude sends, checking a sort plan
// against the pieces, lot numbers that never change, contact-sheet pages and
// the sorting guide Todd reads at the table.

export const VERDICTS = ["lot", "pull", "need_photo", "pool", "discard"] as const;
export type Verdict = (typeof VERDICTS)[number];

/** A session is a Lot Builder sort ("lots": one item type, already lot
 *  material) or a Preview ("preview": a mixed batch Todd isn't optimistic
 *  about, sorted into discard / lot pool / lot with this batch / single). */
export const MODES = ["lots", "preview"] as const;
export type Mode = (typeof MODES)[number];
/** Verdicts each kind of session takes. "pool" and "discard" are Preview only. */
export const MODE_VERDICTS: Record<Mode, readonly Verdict[]> = {
  lots: ["lot", "pull", "need_photo"],
  preview: ["pull", "lot", "pool", "discard", "need_photo"],
};
/** Preview thresholds (Todd, Nov 23, 2026): worth this much alone → its own
 *  listing; under the discard line with no lot it fits → discard. */
export const PREVIEW_SINGLE_MIN = 10;
export const PREVIEW_DISCARD_MAX = 2;

export const LOT_MAX_PIECES = 60; // keep in step with FIT_MAX_PIECES (photo-fit-plan.ts)
export const SHEET_MAX = 16; // pieces on one contact sheet
export const SHEET_DEFAULT = 9;

export type PieceLite = {
  n: number;
  state: string; // sorting | in_lot | pulled | removed
  verdict: string | null;
  lotNo: number | null;
  locked: boolean;
  identification?: string | null;
  estValue?: number | null;
};

export type IdentifyIn = {
  n: number;
  identification: string | null;
  estValue: number | null;
  verdict: Verdict | null;
  reason: string | null;
  photoRequest: string | null;
};

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
};
const money = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= 100000 ? Math.round(n * 100) / 100 : null;
};

/** What Claude sent to lot_build_identify, cleaned. A "pull" needs a reason
 *  (Todd reads it as the alert) and a "need_photo" needs to say which photo. */
export function cleanIdentify(input: unknown, known: Set<number>, mode: Mode = "lots"): { ok: IdentifyIn[]; errors: string[] } {
  const allowed = MODE_VERDICTS[mode] as readonly string[];
  const ok: IdentifyIn[] = [];
  const errors: string[] = [];
  const seen = new Set<number>();
  for (const raw of Array.isArray(input) ? input : []) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const n = Number(r.n);
    if (!Number.isInteger(n) || !known.has(n)) {
      errors.push(`#${String(r.n)}: no such piece`);
      continue;
    }
    if (seen.has(n)) {
      errors.push(`#${n}: listed twice`);
      continue;
    }
    seen.add(n);
    const verdict = allowed.includes(String(r.verdict)) ? (String(r.verdict) as Verdict) : null;
    if (r.verdict != null && !verdict) {
      errors.push(`#${n}: verdict must be ${mode === "preview" ? "pull, lot, pool, discard or need_photo" : "lot, pull or need_photo"}`);
      continue;
    }
    const reason = text(r.reason, 400);
    const photoRequest = text(r.photo_request ?? r.photoRequest, 300);
    if (verdict === "pull" && !reason) {
      errors.push(`#${n}: a pull needs a reason (why it sells better alone)`);
      continue;
    }
    if (verdict === "discard" && !reason) {
      errors.push(`#${n}: a discard needs a reason (why it isn't worth listing, even in a lot)`);
      continue;
    }
    if (verdict === "need_photo" && !photoRequest) {
      errors.push(`#${n}: need_photo needs photo_request (exactly what to photograph)`);
      continue;
    }
    ok.push({
      n,
      identification: text(r.identification, 300),
      estValue: money(r.est_value_usd ?? r.estValue),
      verdict,
      reason,
      photoRequest: verdict === "need_photo" ? photoRequest : null,
    });
  }
  return { ok, errors };
}

export type PlanLotIn = { no: number | null; name: string; pieces: number[]; reason: string | null; suggestedPrice: number | null; guideId: string | null };

/** What Claude sent to lot_build_plan, cleaned (shape only). */
export function cleanPlan(input: unknown): { lots: PlanLotIn[]; errors: string[] } {
  const lots: PlanLotIn[] = [];
  const errors: string[] = [];
  for (const [i, raw] of (Array.isArray(input) ? input : []).entries()) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const name = text(r.name, 120);
    if (!name) {
      errors.push(`lot ${i + 1}: needs a name (the theme a buyer would search)`);
      continue;
    }
    const pieces = Array.from(new Set((Array.isArray(r.pieces) ? r.pieces : []).map(Number).filter((x) => Number.isInteger(x) && x >= 1)));
    const no = Number.isInteger(r.no) && (r.no as number) >= 1 ? (r.no as number) : null;
    lots.push({ no, name, pieces, reason: text(r.reason, 600), suggestedPrice: money(r.suggested_price ?? r.suggestedPrice), guideId: text(r.guide_id ?? r.guideId, 120) });
  }
  return { lots, errors };
}

export type PlanCheck = {
  /** Lots to save, with pieces Claude may not move taken out. */
  lots: PlanLotIn[];
  /** Why a piece was left where it was. */
  skipped: string[];
  errors: string[];
  warnings: string[];
};

/** Check a plan against the session: a piece goes in one lot; pieces Todd
 *  placed (locked), already built or pulled, stay where they are; existing
 *  lot numbers must be real and not built. */
export function checkPlan(lots: PlanLotIn[], pieces: PieceLite[], existing: Array<{ no: number; status: string }>): PlanCheck {
  const byN = new Map(pieces.map((p) => [p.n, p]));
  const lotByNo = new Map(existing.map((l) => [l.no, l]));
  const errors: string[] = [];
  const warnings: string[] = [];
  const skipped: string[] = [];
  const taken = new Map<number, number>(); // piece → index of the lot that has it
  const usedNo = new Set<number>();
  const out: PlanLotIn[] = [];
  for (const [i, lot] of lots.entries()) {
    if (lot.no != null) {
      const ex = lotByNo.get(lot.no);
      if (!ex) errors.push(`lot ${lot.no}: no such lot number (leave "no" out for a new lot)`);
      else if (ex.status === "built") errors.push(`lot ${lot.no} is already built; Todd splits it from its draft page`);
      if (usedNo.has(lot.no)) errors.push(`lot ${lot.no} is in the plan twice`);
      usedNo.add(lot.no);
    }
    const keep: number[] = [];
    for (const n of lot.pieces) {
      const p = byN.get(n);
      if (!p) {
        errors.push(`"${lot.name}": #${n} isn't a piece of this session`);
        continue;
      }
      if (taken.has(n)) {
        errors.push(`#${n} is in two lots of this plan`);
        continue;
      }
      if (p.state !== "sorting") {
        skipped.push(`#${n} (${p.state === "in_lot" ? "already in a built lot" : p.state})`);
        continue;
      }
      if (p.locked && !(lot.no != null && p.lotNo === lot.no)) {
        skipped.push(`#${n} (Todd placed it${p.verdict === "pull" ? " as a pull" : p.verdict === "pool" ? " in the lot pool" : p.verdict === "discard" ? " in discards" : p.lotNo ? ` in lot ${p.lotNo}` : ""})`);
        continue;
      }
      taken.set(n, i);
      keep.push(n);
    }
    if (keep.length > LOT_MAX_PIECES) errors.push(`"${lot.name}": ${keep.length} pieces; a lot holds at most ${LOT_MAX_PIECES}`);
    if (keep.length === 1) warnings.push(`"${lot.name}" has one piece; a lot needs at least two to be built`);
    out.push({ ...lot, pieces: keep });
  }
  return { lots: out, skipped, errors, warnings };
}

/** The next lot number: one more than the highest ever used in the session
 *  (dissolved lots keep theirs, so a physical pile's number is never reused). */
export function nextLotNo(used: number[]): number {
  return used.length ? Math.max(...used) + 1 : 1;
}

/** Piece numbers a page of the contact sheets shows: `count` pieces from
 *  piece number `from` up, `per` to a sheet. */
export function sheetPages(numbers: number[], from: number, count: number, per: number): number[][] {
  const size = Math.max(2, Math.min(SHEET_MAX, Math.floor(per) || SHEET_DEFAULT));
  const start = Math.max(1, Math.floor(from) || 1);
  const want = [...numbers].sort((a, b) => a - b).filter((n) => n >= start).slice(0, Math.max(1, Math.min(2 * SHEET_MAX, Math.floor(count) || size)));
  const pages: number[][] = [];
  for (let i = 0; i < want.length; i += size) pages.push(want.slice(i, i + size));
  return pages;
}

export type GuideRow = { n: number; where: string; kind: "lot" | "pull" | "photo" | "pool" | "discard" | "none" | "done"; what: string | null };

/** The sorting guide: every piece in number order with the pile it goes on. */
export function sortingGuide(pieces: PieceLite[], lotNames: Map<number, string>): GuideRow[] {
  return [...pieces]
    .filter((p) => p.state !== "removed")
    .sort((a, b) => a.n - b.n)
    .map((p) => {
      const what = p.identification ?? null;
      if (p.state === "pulled" || (p.state === "sorting" && p.verdict === "pull")) return { n: p.n, where: "PULL — sell alone", kind: "pull" as const, what };
      if (p.state === "pooled" || (p.state === "sorting" && p.verdict === "pool")) return { n: p.n, where: "LOT POOL bin", kind: "pool" as const, what };
      if (p.state === "discarded" || (p.state === "sorting" && p.verdict === "discard")) return { n: p.n, where: "DISCARD", kind: "discard" as const, what };
      if (p.lotNo != null && (p.state === "in_lot" || p.verdict === "lot" || p.verdict == null))
        return { n: p.n, where: `Lot ${p.lotNo}${lotNames.get(p.lotNo) ? ` — ${lotNames.get(p.lotNo)}` : ""}`, kind: p.state === "in_lot" ? ("done" as const) : ("lot" as const), what };
      if (p.verdict === "need_photo") return { n: p.n, where: "NEEDS PHOTO", kind: "photo" as const, what };
      return { n: p.n, where: "not placed yet", kind: "none" as const, what };
    });
}

/** Is this piece waiting for Claude: never looked at, or it has photos Claude
 *  hasn't seen (Todd added one after a need_photo)? */
export function needsLook(p: { lookedAt: string | null; photos: number; photosSeen: number; state: string }): boolean {
  return p.state === "sorting" && (!p.lookedAt || p.photos > p.photosSeen);
}

/** Todd's instructions on a lot draft built from a sort session (Claude reads
 *  them in listing_get_draft and writes the lot as usual). */
export function lotInstructions(lot: { no: number; name: string; reason: string | null; suggestedPrice: number | null; guideId: string | null }, build: { name: string; kind: string | null }, pieces: Array<{ n: number; identification: string | null; estValue: number | null }>): string {
  const lines = pieces.map((p, i) => `${i + 1}. ${p.identification ?? "not identified"}${p.estValue != null ? ` (alone ≈ $${p.estValue})` : ""} [sort #${p.n}]`);
  return [
    `Built in the Lot Builder from "${build.name}"${build.kind ? ` (${build.kind})` : ""}: lot ${lot.no}, "${lot.name}". Todd approved this lot — write it as ONE lot listing; don't split it or move pieces.`,
    lot.reason ? `Why these go together: ${lot.reason}` : "",
    lot.suggestedPrice != null ? `Suggested lot price from the sort plan: $${lot.suggestedPrice} (check it against the guide's lot bands before using it).` : "",
    lot.guideId ? `Expert Guide used for the sort: ${lot.guideId}.` : "",
    `Pieces, in the lot's photo order (identified during the sort; check each against its photo):\n${lines.join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 3900);
}

/** Todd's instructions on a piece pulled out of a sort session to sell alone. */
export function pullInstructions(p: { n: number; identification: string | null; estValue: number | null; reason: string | null }, build: { name: string; kind: string | null; mode?: Mode }): string {
  const preview = build.mode === "preview";
  return [
    preview
      ? `From the Preview session "${build.name}", piece #${p.n}: Todd approved it for its own listing.`
      : `Pulled from the Lot Builder session "${build.name}"${build.kind ? ` (${build.kind})` : ""}, piece #${p.n}, to sell on its own.`,
    p.identification ? `Identified during the ${preview ? "preview" : "sort"} as: ${p.identification}.` : "",
    p.reason ? `Why it ${preview ? "earns its own listing" : "was pulled"}: ${p.reason}` : "",
    p.estValue != null ? `Estimated alone: about $${p.estValue}.` : "",
    `Write it as a single listing. If the photos don't show what a single listing needs (a label, a back, a grade), say so in flags.`,
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 1900);
}

export type PreviewBucket = "single" | "lot" | "pool" | "discard" | "look" | "undecided";
export const PREVIEW_BUCKETS: readonly PreviewBucket[] = ["single", "lot", "pool", "discard", "look", "undecided"];

/** Which Preview pile a piece is in (also once it has been sent on). */
export function previewBucket(p: PieceLite): PreviewBucket | null {
  if (p.state === "removed") return null;
  if (p.state === "pulled") return "single";
  if (p.state === "in_lot") return "lot";
  if (p.state === "pooled") return "pool";
  if (p.state === "discarded") return "discard";
  if (p.verdict === "pull") return "single";
  if (p.verdict === "pool") return "pool";
  if (p.verdict === "discard") return "discard";
  if (p.verdict === "need_photo") return "look";
  if (p.lotNo != null) return "lot";
  return "undecided"; // not looked at, or lot material with no lot yet
}

/** The Preview report: how many pieces and how much value (alone) per pile. */
export function previewSummary(pieces: PieceLite[]): Record<PreviewBucket, { pieces: number; est: number }> {
  const out = Object.fromEntries(PREVIEW_BUCKETS.map((b) => [b, { pieces: 0, est: 0 }])) as Record<PreviewBucket, { pieces: number; est: number }>;
  for (const p of pieces) {
    const b = previewBucket(p);
    if (!b) continue;
    out[b].pieces += 1;
    out[b].est = Math.round((out[b].est + (p.estValue ?? 0)) * 100) / 100;
  }
  return out;
}
