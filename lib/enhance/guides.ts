// Expert guide library for the remix ops.
//
// D4 (2026-09-01): the gateway worker is now the source of truth. The
// ai-gateway KV holds every guide in the library (31+ and growing) plus the
// manifest v2 metadata — family, parent, stage, keywords, priority — which
// `GET /guides` merges into each row and returns alongside a canonical
// `families` array. The five markdown files under content/expert-guides/
// stay in the bundle as an OFFLINE FALLBACK only: if the gateway is
// unreachable or unconfigured, the portal still works with what shipped.
//
// A guide is the LARGE cacheable prompt prefix (decision #7): passed to
// callLlm as `cacheableSystem`, so Anthropic bills it at 10% on every
// call after the first within the cache window. Auto-routing (see
// routeGuideIds) varies that prefix per job, which trades some cache hits
// for the right guide — the batch form says so.

import fs from "fs";
import path from "path";

const GUIDES_DIR = path.join(process.cwd(), "content", "expert-guides");
const TTL_MS = 6 * 60 * 60 * 1000; // 6h, matching the Nifty extension

export type GuideMeta = {
  id: string;
  name: string;
  file: string;
  keywords: string[];
  family: string;
  parent: string | null;
  stage: string;
  priority: number;
  description: string;
  updated: string | null;
  /** true when this row came from the bundled fallback, not the gateway */
  local?: boolean;
};

export type Guide = GuideMeta & { content: string };

/** Marker for "route within this family per job" — the value the batch form
 *  puts in config.guideId when you pick a whole family. */
export const FAMILY_PREFIX = "family:";
export function isFamilySelection(id: string): boolean {
  return typeof id === "string" && id.startsWith(FAMILY_PREFIX);
}
export function familyOfSelection(id: string): string {
  return isFamilySelection(id) ? id.slice(FAMILY_PREFIX.length) : "";
}

// ── caches (per lambda instance; 6h TTL) ────────────────────────────────────
let listCache: { at: number; guides: GuideMeta[]; families: string[] } | null = null;
const bodyCache = new Map<string, { at: number; content: string }>();

function gatewayEnv(): { url: string; token: string } | null {
  const url = process.env.AI_GATEWAY_URL?.replace(/\/+$/, "");
  const token = process.env.AI_GATEWAY_TOKEN;
  return url && token ? { url, token } : null;
}

function normalizeRow(g: Record<string, unknown>): GuideMeta {
  const id = String(g.id ?? "");
  return {
    id,
    name: String(g.title ?? g.name ?? id),
    file: String(g.file ?? `${id}.md`),
    keywords: Array.isArray(g.keywords) ? g.keywords.map(String) : [],
    family: String(g.family ?? "Unassigned"),
    parent: g.parent ? String(g.parent) : null,
    stage: String(g.stage ?? "list"),
    priority: Number(g.priority ?? 3) || 3,
    description: String(g.description ?? ""),
    updated: g.updated ? String(g.updated) : null,
  };
}

// ── bundled fallback ────────────────────────────────────────────────────────
type LocalManifest = { version: number; guides: Array<Record<string, unknown>> };

function localGuides(): GuideMeta[] {
  try {
    const raw = fs.readFileSync(path.join(GUIDES_DIR, "manifest.json"), "utf-8");
    const manifest = JSON.parse(raw) as LocalManifest;
    const rows = Array.isArray(manifest.guides) ? manifest.guides : [];
    return rows.map((g) => ({ ...normalizeRow(g), family: "Bundled (offline)", local: true }));
  } catch (err) {
    console.error("[guides] failed to read bundled manifest:", err);
    return [];
  }
}

function localBody(meta: GuideMeta): string | null {
  // Guard against path traversal — file must stay inside GUIDES_DIR.
  const file = path.join(GUIDES_DIR, path.basename(meta.file));
  try {
    return fs.readFileSync(file, "utf-8");
  } catch {
    return null;
  }
}

// ── public API ──────────────────────────────────────────────────────────────

/** Every guide in the library, gateway-first with a bundled fallback. */
export async function listGuides(): Promise<GuideMeta[]> {
  return (await guideLibrary()).guides;
}

/** Family names in manifest order (empty when only the fallback is available). */
export async function listGuideFamilies(): Promise<string[]> {
  return (await guideLibrary()).families;
}

export async function guideLibrary(): Promise<{ guides: GuideMeta[]; families: string[] }> {
  if (listCache && Date.now() - listCache.at < TTL_MS) {
    return { guides: listCache.guides, families: listCache.families };
  }
  const env = gatewayEnv();
  if (env) {
    try {
      const res = await fetch(`${env.url}/guides`, {
        headers: { authorization: `Bearer ${env.token}` },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`guides HTTP ${res.status}`);
      const body = (await res.json()) as { guides?: Array<Record<string, unknown>>; families?: string[] };
      const guides = (body.guides ?? []).map(normalizeRow).filter((g) => g.id);
      if (guides.length > 0) {
        const families = Array.isArray(body.families) && body.families.length
          ? body.families.map(String)
          : Array.from(new Set(guides.map((g) => g.family)));
        listCache = { at: Date.now(), guides, families };
        return { guides, families };
      }
    } catch (err) {
      console.error("[guides] gateway unreachable, using bundled copy:", err);
    }
  }
  const guides = localGuides();
  const families = Array.from(new Set(guides.map((g) => g.family)));
  // Cache the fallback briefly so a dead gateway doesn't get hammered per job.
  listCache = { at: Date.now() - TTL_MS + 5 * 60 * 1000, guides, families };
  return { guides, families };
}

export async function loadGuide(id: string): Promise<Guide | null> {
  const meta = (await listGuides()).find((g) => g.id === id);
  if (!meta) return null;

  const cached = bodyCache.get(id);
  if (cached && Date.now() - cached.at < TTL_MS) return { ...meta, content: cached.content };

  const env = gatewayEnv();
  if (env && !meta.local) {
    try {
      const res = await fetch(`${env.url}/guides/${encodeURIComponent(id)}`, {
        headers: { authorization: `Bearer ${env.token}` },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`guide HTTP ${res.status}`);
      const content = await res.text();
      if (content.trim()) {
        bodyCache.set(id, { at: Date.now(), content });
        return { ...meta, content };
      }
    } catch (err) {
      console.error(`[guides] failed to fetch guide "${id}" from the gateway:`, err);
    }
  }
  const content = localBody(meta);
  if (content === null) return null;
  bodyCache.set(id, { at: Date.now(), content });
  return { ...meta, content };
}

/** Test seam / admin action: drop the caches so the next read re-fetches. */
export function clearGuideCache(): void {
  listCache = null;
  bodyCache.clear();
}

// ── tier-0 router (ported from the Nifty extension, v1.42) ──────────────────

export function guideKeywordHits(g: GuideMeta, lowerText: string): number {
  if (!lowerText) return 0;
  let hits = 0;
  for (const raw of g.keywords) {
    const k = String(raw ?? "").toLowerCase().trim();
    if (k.length < 3) continue;
    if (lowerText.includes(k)) hits++;
  }
  return hits;
}

function parentsOf(pool: GuideMeta[]): GuideMeta[] {
  const present = new Set(pool.map((g) => g.id));
  return pool.filter((g) => !g.parent || !present.has(g.parent));
}

/**
 * Pick the guides that fit `text` out of `pool`.
 *
 * Family gate (only the best-scoring families survive) → that family's parent
 * always → its best-matching child → a second child only when it scores at
 * least 2 AND at least half the leader. Returns parents alone when nothing
 * matches, which is the safe answer for a batch job.
 */
export function routeGuides(pool: GuideMeta[], text: string): GuideMeta[] {
  if (pool.length <= 1) return pool;
  const t = String(text ?? "").toLowerCase();

  const fams = new Map<string, GuideMeta[]>();
  for (const g of pool) {
    const arr = fams.get(g.family) ?? [];
    arr.push(g);
    fams.set(g.family, arr);
  }

  let best = 0;
  const score = new Map<string, number>();
  for (const [f, gs] of fams) {
    const s = gs.reduce((m, g) => Math.max(m, guideKeywordHits(g, t)), 0);
    score.set(f, s);
    if (s > best) best = s;
  }
  if (best === 0 && fams.size > 1) return parentsOf(pool);

  const keep = best > 0 ? [...fams.keys()].filter((f) => score.get(f) === best) : [...fams.keys()];
  const out: GuideMeta[] = [];
  const push = (g: GuideMeta) => { if (!out.some((x) => x.id === g.id)) out.push(g); };

  for (const f of keep) {
    const gs = fams.get(f) ?? [];
    const present = new Set(gs.map((g) => g.id));
    const parents = gs.filter((g) => !g.parent || !present.has(g.parent));
    const kids = gs.filter((g) => g.parent && present.has(g.parent));
    parents.forEach(push);
    if (kids.length === 0) continue;
    const scored = kids
      .map((g) => ({ g, n: guideKeywordHits(g, t) }))
      .sort((a, b) => b.n - a.n);
    if (scored[0].n === 0) continue; // the parent carries it
    push(scored[0].g);
    if (scored[1] && scored[1].n >= 2 && scored[1].n >= scored[0].n / 2) push(scored[1].g);
  }
  return out.length > 0 ? out : parentsOf(pool);
}

/**
 * Resolve a batch's `config.guideId` for one job.
 *
 * - "family:Postcards" → route within that family using the listing text and
 *   load the single best guide (the parent when nothing matches).
 * - a plain guide id  → that guide, no routing.
 */
export async function resolveGuideForJob(
  guideId: string,
  routeText: string
): Promise<{ guide: Guide | null; error: string | null; routedBy: string | null }> {
  if (!guideId) return { guide: null, error: "No guideId in batch config", routedBy: null };

  if (!isFamilySelection(guideId)) {
    const guide = await loadGuide(guideId);
    return guide
      ? { guide, error: null, routedBy: null }
      : { guide: null, error: `Guide "${guideId}" not found in the library`, routedBy: null };
  }

  const family = familyOfSelection(guideId);
  const pool = (await listGuides()).filter((g) => g.family === family && g.stage !== "buy");
  if (pool.length === 0) {
    return { guide: null, error: `No guides in family "${family}"`, routedBy: null };
  }
  const routed = routeGuides(pool, routeText);
  const pick = routed[0] ?? pool[0];
  const guide = await loadGuide(pick.id);
  return guide
    ? { guide, error: null, routedBy: `${family} → ${pick.id}` }
    : { guide: null, error: `Guide "${pick.id}" could not be loaded`, routedBy: null };
}

/**
 * Pull one named section out of a guide's markdown — used by item_specifics
 * for an optional "ITEM SPECIFICS MAP" section. Matches any heading level,
 * returns everything up to the next heading of the same or higher level.
 */
export function guideSection(content: string, headingRe: RegExp): string | null {
  const lines = content.split(/\r?\n/);
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+(.*)$/.exec(lines[i]);
    if (!m) continue;
    if (start === -1) {
      if (headingRe.test(m[2])) { start = i; level = m[1].length; }
    } else if (m[1].length <= level) {
      return lines.slice(start, i).join("\n").trim();
    }
  }
  return start === -1 ? null : lines.slice(start).join("\n").trim();
}

export const ITEM_SPECIFICS_HEADING = /item\s*specifics\s*map/i;
