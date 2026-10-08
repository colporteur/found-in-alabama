// Run: npx tsx --test lib/listings/nifty.test.mts
import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_TEMPLATES, niftyIdFrom, parseTemplates, pickTemplateKey } from "./nifty";

test("template ids come from ids or Nifty edit links", () => {
  const id = "16ac8099-ee60-460d-9f15-db1495288754";
  assert.equal(niftyIdFrom(`https://app.nifty.ai/inventory/edit/${id}`), id);
  assert.equal(niftyIdFrom("nope"), null);
  const t = parseTemplates({ book: `https://app.nifty.ai/inventory/edit/${id}`, media: "junk" });
  assert.equal(t.book, id);
  assert.equal(t.media, DEFAULT_TEMPLATES.media);
});

test("which template a draft uses", () => {
  const pc = "Collectibles > Postcards & Supplies > Postcards > Topographical Postcards";
  assert.equal(pickTemplateKey({ kind: "postcard", categoryPath: pc, shippingProfile: "envelope", title: "Linen Postcard Selma" }), "postcard");
  assert.equal(pickTemplateKey({ kind: "postcard", categoryPath: pc, title: "RPPC Depot Real Photo" }), "photo");
  assert.equal(pickTemplateKey({ kind: "book", categoryPath: "Books & Magazines > Books" }), "book");
  assert.equal(pickTemplateKey({ kind: "record", categoryPath: "Music > Vinyl Records" }), "media");
  assert.equal(pickTemplateKey({ kind: "ephemera", shippingProfile: "calculated" }), "paper_calculated");
  assert.equal(pickTemplateKey({ kind: "ephemera", shippingProfile: "envelope" }), "paper_envelope");
  assert.equal(pickTemplateKey({ kind: "other", categoryPath: "Collectibles > Advertising", shippingProfile: "calculated" }), "general");
});
