// Run: npx tsx --test lib/listings/folder-lot.test.mts
import test from "node:test";
import assert from "node:assert/strict";
import { planFolderLot, SOLO_SLOTS, FOLDER_LOT_MAX } from "./folder-lot";
import { badgesSvg, digitPath, layoutCover } from "./cover";
import { parseIntakeRequest, MAX_LOT_PHOTOS } from "./validate";

test("23 or fewer pieces: every piece gets its own photo, no grid", () => {
  assert.deepEqual(planFolderLot(5), { solo: [1, 2, 3, 4, 5], grid: [] });
  assert.deepEqual(planFolderLot(4, [3]), { solo: [3, 1, 2, 4], grid: [] });
  const p = planFolderLot(23);
  assert.equal(p.solo.length, 23);
  assert.equal(p.grid.length, 0);
});

test("more than 23: 22 solos + a grid of the rest = 24 listed photos with the overview", () => {
  for (const n of [24, 26, 27, 40, 60]) {
    const { solo, grid } = planFolderLot(n);
    assert.equal(solo.length, SOLO_SLOTS);
    assert.equal(1 + solo.length + 1, 24);
    assert.deepEqual([...solo, ...grid].sort((a, b) => a - b), Array.from({ length: n }, (_, i) => i + 1));
  }
  assert.deepEqual(planFolderLot(26).grid, [23, 24, 25, 26]);
});

test("Claude's picks come first, are deduplicated and checked, and are topped up", () => {
  const { solo, grid } = planFolderLot(26, [18, 18, 99, 0, 2.5, 26, 3]);
  assert.deepEqual(solo.slice(0, 3), [18, 26, 3]);
  assert.equal(solo.length, 22);
  assert.ok(!grid.includes(18) && !grid.includes(26));
  // Too many picks: only 22 kept
  assert.equal(planFolderLot(30, Array.from({ length: 30 }, (_, i) => 30 - i)).solo[0], 30);
  assert.equal(planFolderLot(30, Array.from({ length: 30 }, (_, i) => 30 - i)).solo.length, 22);
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
