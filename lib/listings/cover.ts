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
    const availH = side - gap * (rows.length + 1);
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

/** Fetch the photos and build the cover JPEG (up to 23 photos, in order). */
export async function renderCover(urls: string[], side = COVER_SIZE): Promise<Buffer> {
  const use = urls.slice(0, COVER_MAX_TILES);
  if (!use.length) throw new Error("Pick at least one photo for the cover");
  // Upright copies (camera EXIF applied) and their shapes.
  const imgs = await Promise.all(
    use.map(async (u) => {
      const res = await fetch(u, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`Couldn't read a photo (HTTP ${res.status})`);
      const buf = await sharp(Buffer.from(await res.arrayBuffer()), { failOn: "none" }).rotate().toBuffer();
      const m = await sharp(buf).metadata();
      return { buf, aspect: (m.width ?? 1) / (m.height ?? 1) };
    })
  );
  const tiles = layoutCover(imgs.map((i) => i.aspect), side);
  const line = Math.max(1, Math.round(side / 800));
  const parts = await Promise.all(
    tiles.map(async (t) => {
      const inner = await sharp(imgs[t.index].buf)
        .resize(Math.max(1, t.w - 2 * line), Math.max(1, t.h - 2 * line), { fit: "fill" })
        .extend({ top: line, bottom: line, left: line, right: line, background: BORDER })
        .jpeg({ quality: 92 })
        .toBuffer();
      return { input: inner, left: Math.max(0, t.x), top: Math.max(0, t.y) };
    })
  );
  return sharp({ create: { width: side, height: side, channels: 3, background: "#ffffff" } })
    .composite(parts)
    .jpeg({ quality: 90 })
    .toBuffer();
}
