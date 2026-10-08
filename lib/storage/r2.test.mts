// Run: npx tsx --test lib/storage/r2.test.mts
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAccountId } from "./r2";

const ID = "0123456789abcdef0123456789abcdef";

test("bare account IDs pass through", () => {
  assert.equal(normalizeAccountId(` ${ID} `), ID);
  assert.equal(normalizeAccountId(""), undefined);
  assert.equal(normalizeAccountId(undefined), undefined);
});

test("the S3 endpoint URL from the Cloudflare dashboard is reduced to the ID", () => {
  assert.equal(normalizeAccountId(`https://${ID}.r2.cloudflarestorage.com`), ID);
  assert.equal(normalizeAccountId(`https://${ID}.r2.cloudflarestorage.com/`), ID);
  assert.equal(normalizeAccountId(`https://${ID}.r2.cloudflarestorage.com/fia-listing-photos`), ID);
  assert.equal(normalizeAccountId(`${ID}.r2.cloudflarestorage.com`), ID);
});
