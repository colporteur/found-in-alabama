// Lot cover collage, ported from Scanroom's "lot cover" (Scanroom.html,
// packCover / renderCollage) so FIA can build one on the server: the photos
// tiled onto one square, white background, each keeping its own shape (no
// cropping), in "justified rows" scaled so every row spans the width, with a
// hairline round each piece so white paper still reads as an item.
// The packing is pure (tested); renderCover does the pixels with sharp.

import sharp from "sharp";

export const COVER_SIZE = 1600; // square: eBay crops gallery thumbnails to a square
export const COVER_MAX_TILES = 23; // 23 tiles + the cover itself = eBay's 24 photos
const COVER_GAP = 0.022; // outer margin and gutter, as a fraction of the side
const BORDER = "#dcd8cf";

/** Split photos (aspects = width ÷ height, in order) into R rows of as equal
 *  total width as possible — linear-partition DP, order kept. */
export function balancedRows(aspects: number[], R: number): number[][] {
  const n = aspects.length;
  if (R >= n) return aspects.map((_, i) => [i]);
  const pre = [0];
  for (let i = 0; i < n; i++) pre.push(pre[i] + aspects[i]);
  const dp = Array.from({ length: R + 1 }, () => new Array<number>(n + 1).fill(Infinity));
  const cut = Array.from({ length: R + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 1; i <= n; i++) dp[1][i] = pre[i];
  for (let r = 2; r <= R; r++) {
    for (let i = r; i <= n; i++) {
      for (let j = r - 1; j < i; j++) {
        const v = Math.max(dp[r - 1][j], pre[i] - pre[j]);
        if (v < dp[r][i]) {
          dp[r][i] = v;
          cut[r][i] = j;
        }
      }
    }
  }
  const rows: number[][] = [];
  let i = n;
  for (let r = R; r >= 1; r--) {
    const j = r === 1 ? 0 : cut[r][i];
    rows.unshift(Array.from({ length: i - j }, (_, k) => j + k));
    i = j;
  }
  return rows;
}

export type Tile = { index: number; x: number; y: number; w: number; h: number };

/** Where each photo goes on a side × side square. Tries every row count and
 *  keeps the one that covers the most area with the most even row heights
 *  (so three like postcards don't come out at three sizes). */
export function layoutCover(aspects: number[], side = COVER_SIZE): Tile[] {
  const n = aspects.length;
  if (!n) return [];
  const gap = Math.round(side * COVER_GAP);
  let best: { rows: number[][]; hs: number[]; f: number; score: number } | null = null;
  for (let R = 1; R <= n; R++) {
    if ((side - gap * (R + 1)) / R < 8) break;
    const rows = balancedRows(aspects, R);
    const hs = rows.map((r) => {
      const availW = side - 2 * gap - gap * (r.length - 1);
      return availW / r.reduce((s, i) => s + aspects[i], 0);
    });
    // Too many in one row: the gutters alone are wider than the square
    // (a negative height here once made 50 cards come out 1358 px wide).
    if (hs.some((h) => !(h > 0))) continue;
    const availH = side - gap * (rows.length + 1);
    if (availH <= 0) break;
    const f = Math.min(1, availH / hs.reduce((a, b) => a + b, 0));
    const area = rows.reduce((acc, r, k) => acc + r.reduce((s, i) => s + aspects[i] * (hs[k] * f) * (hs[k] * f), 0), 0);
    const fair = Math.min(...hs) / Math.max(...hs);
    const score = area * Math.sqrt(fair);
    if (!best || score > best.score) best = { rows, hs, f, score };
  }
  if (!best) return [];
  const heights = best.hs.map((h) => h * best!.f);
  const stack = heights.reduce((a, b) => a + b, 0) + gap * (best.rows.length + 1);
  let y = (side - stack) / 2 + gap; // centre the block vertically
  const tiles: Tile[] = [];
  best.rows.forEach((r, k) => {
    const h = heights[k];
    const widths = r.map((i) => aspects[i] * h);
    const rowW = widths.reduce((a, b) => a + b, 0) + gap * (r.length - 1);
    let x = (side - rowW) / 2; // centre a short last row
    r.forEach((i, j) => {
      tiles.push({ index: i, x: Math.round(x), y: Math.round(y), w: Math.max(4, Math.round(widths[j])), h: Math.max(4, Math.round(h)) });
      x += widths[j] + gap;
    });
    y += h + gap;
  });
  return tiles;
}

// ─── numbered badges ────────────────────────────────────────────────────────
// Piece numbers are drawn as stroked paths, not text: sharp's SVG renderer
// on Vercel has no fonts to rely on, but paths always render.

const SEG: Record<string, string> = {
  a: "M1 1h8", b: "M9 1v8", c: "M9 9v8", d: "M1 17h8", e: "M1 9v8", f: "M1 1v8", g: "M1 9h8",
};
const DIGITS = ["abcdef", "bc", "abged", "abgcd", "fgbc", "afgcd", "afgedc", "abc", "abcdefg", "abcdfg"];

/** Pure: path data for a number in a 10×18 cell per digit (12 apart). */
export function digitPath(label: string): { d: string; width: number } {
  const chars = label.replace(/\D/g, "").split("");
  const d = chars
    .map((c, i) => DIGITS[Number(c)].split("").map((k) => SEG[k].replace(/^M(\d+) (\d+)/, (_, x, y) => `M${Number(x) + i * 12} ${y}`)).join(""))
    .join("");
  return { d, width: chars.length ? chars.length * 12 - 2 : 0 };
}

/** Pure: one SVG (side × side) with a numbered badge in each tile's corner. */
export function badgesSvg(tiles: Tile[], labels: string[], side: number): string {
  const parts = tiles
    .filter((t) => labels[t.index])
    .map((t) => {
      const { d, width } = digitPath(labels[t.index]);
      const h = Math.round(Math.max(22, Math.min(60, Math.min(t.w, t.h) * 0.17)));
      const s = (h * 0.62) / 18; // digit cell height → badge
      const w = Math.round(Math.max(h, width * s + h * 0.55));
      const x = t.x + Math.round(h * 0.15);
      const y = t.y + Math.round(h * 0.15);
      const tx = x + (w - width * s) / 2;
      const ty = y + (h - 18 * s) / 2;
      return (
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.round(h / 2)}" fill="#1c1917" fill-opacity="0.86" stroke="#ffffff" stroke-width="${Math.max(1, Math.round(h / 16))}"/>` +
        `<path d="${d}" transform="translate(${tx.toFixed(1)} ${ty.toFixed(1)}) scale(${s.toFixed(3)})" fill="none" stroke="#ffffff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`
      );
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}" viewBox="0 0 ${side} ${side}">${parts}</svg>`;
}

/** Fetch photos a few at a time and shrink each on load (scans are ~30 MP;
 *  holding a few dozen at full size would run a server function out of memory). */
async function loadForTiles(urls: string[], maxEdge: number): Promise<Array<{ buf: Buffer; aspect: number }>> {
  const out: Array<{ buf: Buffer; aspect: number }> = new Array(urls.length);
  let next = 0;
  async function worker() {
    while (next < urls.length) {
      const i = next++;
      const res = await fetch(urls[i], { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`Couldn't read a photo (HTTP ${res.status})`);
      const { data, info } = await sharp(Buffer.from(await res.arrayBuffer()), { failOn: "none" })
        .rotate()
        .resize(maxEdge, maxEdge, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 92 })
        .toBuffer({ resolveWithObject: true });
      out[i] = { buf: data, aspect: (info.width || 1) / (info.height || 1) };
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, urls.length) }, worker));
  return out;
}

export type CoverOptions = {
  /** A number (or "" for none) per photo, drawn in a badge on its tile. */
  labels?: string[];
  /** More tiles than eBay's 23 (a whole-folder lot's overview). */
  maxTiles?: number;
};

/** Fetch the photos and build the cover JPEG (up to 23 photos, in order,
 *  unless opts.maxTiles allows more). */
export async function renderCover(urls: string[], side = COVER_SIZE, opts: CoverOptions = {}): Promise<Buffer> {
  const use = urls.slice(0, opts.maxTiles ?? COVER_MAX_TILES);
  if (!use.length) throw new Error("Pick at least one photo for the cover");
  // Upright copies (camera EXIF applied), shrunk to what a tile can show.
  const imgs = await loadForTiles(use, Math.min(side, 1400));
  const tiles = layoutCover(imgs.map((i) => i.aspect), side);
  const line = Math.max(1, Math.round(side / 800));
  const parts: sharp.OverlayOptions[] = await Promise.all(
    tiles.map(async (t) => {
      const inner = await sharp(imgs[t.index].buf)
        .resize(Math.max(1, t.w - 2 * line), Math.max(1, t.h - 2 * line), { fit: "fill" })
        .extend({ top: line, bottom: line, left: line, right: line, background: BORDER })
        .jpeg({ quality: 92 })
        .toBuffer();
      return { input: inner, left: Math.max(0, t.x), top: Math.max(0, t.y) };
    })
  );
  if (opts.labels?.some(Boolean)) parts.push({ input: Buffer.from(badgesSvg(tiles, opts.labels, side)), left: 0, top: 0 });
  return sharp({ create: { width: side, height: side, channels: 3, background: "#ffffff" } })
    .composite(parts)
    .jpeg({ quality: 90 })
    .toBuffer();
}
