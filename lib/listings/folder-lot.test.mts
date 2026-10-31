// Run: npx tsx --test lib/listings/folder-lot.test.mts
import test from "node:test";
import assert from "node:assert/strict";
import { planFolderLot, maxPicks, FOLDER_LOT_MAX } from "./folder-lot";
import { badgesSvg, digitPath, layoutCover } from "./cover";
import { parseIntakeRequest, MAX_LOT_PHOTOS } from "./validate";

test("23 or fewer pieces: every piece gets its own photo", () => {
  const p = planFolderLot(5);
  assert.deepEqual(p.tiles.map((t) => t.scans[0]), ["1", "2", "3", "4", "5"]);
  assert.deepEqual(planFolderLot(4, [3]).tiles.map((t) => t.scans[0]), ["3", "1", "2", "4"]);
  assert.equal(planFolderLot(23).tiles.length, 23);
  assert.equal(planFolderLot(23).merged, false);
});

test("more than 23: neighbours share merged photos so every piece shows in 24", () => {
  for (const n of [24, 26, 27, 40, 60]) {
    const p = planFolderLot(n);
    assert.ok(p.tiles.length <= 23);
    assert.ok(p.tiles.every((t) => t.scans.length <= 4));
    assert.deepEqual(p.tiles.flatMap((t) => t.scans).map(Number).sort((a, b) => a - b), Array.from({ length: n }, (_, i) => i + 1));
    assert.deepEqual(p.dropped, []);
  }
  // 26 pieces: only 3 photos merge two pieces
  assert.equal(planFolderLot(26).tiles.filter((t) => t.scans.length === 2).length, 3);
});

test("picks keep their own photo, are deduplicated and checked, and capped at what still fits", () => {
  const p = planFolderLot(26, [18, 18, 99, 0, 2.5, 26, 3]);
  assert.deepEqual(p.tiles.slice(0, 3).map((t) => t.scans), [["18"], ["26"], ["3"]]);
  assert.equal(maxPicks(20), 20);
  assert.equal(maxPicks(40), 17);
  assert.equal(maxPicks(60), 10);
  const many = planFolderLot(60, Array.from({ length: 30 }, (_, i) => 30 - i));
  assert.equal(many.tiles[0].scans[0], "30");
  assert.deepEqual(many.dropped, []);
  assert.equal(many.tiles.filter((t) => t.scans.length === 1).length >= 10, true);
});

test("solo photos only: the first 23 pieces, no merging", () => {
  const p = planFolderLot(30, null, true);
  assert.equal(p.tiles.length, 23);
  assert.ok(p.tiles.every((t) => t.scans.length === 1));
  assert.deepEqual(p.dropped, [24, 25, 26, 27, 28, 29, 30]);
});

test("digits draw as paths, one 12-wide cell each", () => {
  assert.equal(digitPath("7").width, 10);
  assert.equal(digitPath("26").width, 22);
  assert.match(digitPath("26").d, /M13 1h8/); // second digit shifted right
  assert.equal(digitPath("").d, "");
});

test("badges SVG has one badge per labelled tile", () => {
  const tiles = layoutCover([1.3, 0.77, 1.3], 1600);
  const svg = badgesSvg(tiles, ["1", "", "3"], 1600);
  assert.equal((svg.match(/<rect/g) ?? []).length, 2);
  assert.match(svg, /^<svg[^>]+width="1600"/);
});

test("intake: a folder lot may carry more than 24 photos, a normal item may not", () => {
  const photos = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ name: `p${i}.jpg`, sha256: i.toString(16).padStart(64, "0"), bytes: 1000, contentType: "image/jpeg" }));
  const lot = parseIntakeRequest({ source: "scans", photos: photos(26), folderLot: true });
  assert.ok(lot.ok && lot.value.folderLot && lot.value.photos.length === 26);
  assert.equal(parseIntakeRequest({ source: "scans", photos: photos(26) }).ok, false);
  assert.equal(parseIntakeRequest({ source: "scans", photos: photos(MAX_LOT_PHOTOS + 1), folderLot: true }).ok, false);
  assert.equal(parseIntakeRequest({ source: "scans", photos: photos(1), folderLot: true }).ok, false);
  assert.equal(MAX_LOT_PHOTOS, FOLDER_LOT_MAX);
});

test("crowded covers stay inside the square (50 and 60 cards)", () => {
  for (const n of [23, 40, 50, 60]) {
    const t = layoutCover(Array(n).fill(0.71), 2000);
    assert.equal(t.length, n);
    assert.ok(Math.max(...t.map((x) => x.x + x.w)) <= 2000, `n=${n} too wide`);
    assert.ok(Math.max(...t.map((x) => x.y + x.h)) <= 2000, `n=${n} too tall`);
    assert.ok(t.every((x) => x.x >= 0 && x.y >= 0));
  }
});
