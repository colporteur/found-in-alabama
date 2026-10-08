// Run: npx tsx --test lib/sales/parse.test.mts
//
// Fixtures are REDACTED reconstructions of real sale emails (Oct 2026): same
// structure, sender and wording, but buyer names, handles, addresses, order
// ids and tracking numbers are invented. Never paste a real buyer's details
// here — this repo is public.
import test from "node:test";
import assert from "node:assert/strict";
import { parseSaleEmail, normalizeTitle, htmlToText } from "./parse";

// ─── Mercari ──────────────────────────────────────────────────────────────────

const MERCARI_HTML = `<html><body><table>
<tr><td>Countdown to cash</td></tr>
<tr><td>Item details</td></tr>
<tr><td><a href="https://ablink.links.us.mercari.com/x">Vintage Hell in Texas Poem Postcard E. C. Kropp Co T43 Western Cowboy Art</a></td></tr>
<tr><td>ID: m10000000001</td></tr>
<tr><td>Price</td><td>Selling fee</td></tr>
<tr><td>$13.00</td><td>-$1.79</td></tr>
<tr><td>Earnings</td><td>$11.21</td></tr>
<tr><td>Shipping to</td></tr><tr><td>Pat Example</td></tr><tr><td>Springfield, TX</td></tr>
</table></body></html>`;

test("mercari: title from subject, listing id and price from body (HTML only)", () => {
  const r = parseSaleEmail({
    from: "Mercari <no-reply@alerts.us.mercari.com>",
    subject: "You've made a sale: Vintage Hell in Texas Poem Postcard E. C. Kropp Co T43 Western Cowboy Art",
    text: null,
    html: MERCARI_HTML,
  });
  assert.deepEqual(r, {
    kind: "sale",
    venue: "mercari",
    orderRef: "m10000000001",
    lines: [
      {
        title: "Vintage Hell in Texas Poem Postcard E. C. Kropp Co T43 Western Cowboy Art",
        titleTruncated: false,
        venueListingId: "m10000000001",
        price: 13,
      },
    ],
  });
});

test("mercari: text part with link noise between title and id", () => {
  const text = [
    "         Item details",
    "",
    "Some Title Here (",
    "https://ablink.links.us.mercari.com/ls/click?upn=abc )",
    "",
    "ID: m20000000002",
    "",
    "Price",
    "Selling fee",
    "$7.50",
  ].join("\r\n");
  const r = parseSaleEmail({
    from: "no-reply@alerts.us.mercari.com",
    subject: "You’ve made a sale: Some Title Here",
    text,
    html: null,
  });
  assert.ok(r && r.kind === "sale");
  assert.equal(r.lines[0].venueListingId, "m20000000002");
  assert.equal(r.lines[0].price, 7.5);
});

test("mercari: other notifications are ignored", () => {
  assert.equal(
    parseSaleEmail({ from: "no-reply@alerts.us.mercari.com", subject: "Your item was liked", text: "x", html: null }),
    null
  );
});

// ─── Poshmark ─────────────────────────────────────────────────────────────────

const POSH_HTML = `<html><body><table>
<tr><td><div>Hi Todd! Great news -  you just sold &quot;Dabo Swinney Signed Clemson Tigers Framed Photo Howards Rock Autograph VG+&quot; on Poshmark.</div></td></tr>
<tr><td><table><tr><td>Buyer </td></tr><tr><td>Pat Example</td></tr><tr><td>@buyer_handle</td></tr></table>
<table><tr><td>Order Date</td></tr><tr><td>October 05, 2026</td></tr></table>
<table><tr><td>Order ID</td><tr><td>0123456789abcdef01234567</td></tr><td>Tracking Number</td><tr><td>9400000000000000000000</td></tr></tr></table></td></tr>
<tr><td><table><tr><td><img src="x.jpg" /></td><td><table width="360">
<tr><td>Dabo Swinney Signed Clemson Tigers Framed Photo Howards Rock Autograph VG+</td></tr>
<tr><td>Size: OS</td></tr>
<tr><td><span class="price" style="display:none">Price: $24.00</span></td></tr>
<tr><td>SKU: ArtGallery</td></tr></table></td><td class="price">$24.00</td></tr></table></td></tr>
<tr><td>Your Earnings (minus fee and taxes)</td><td>$19.20</td></tr>
</table></body></html>`;

test("poshmark: single sale from HTML", () => {
  const r = parseSaleEmail({
    from: "Poshmark <orders@poshmark.com>",
    subject: '"Dabo Swinney Signed Clemson Tigers Framed Photo Howards Rock Autograph VG+" just sold to @buyer_handle on Poshmark!',
    text: null,
    html: POSH_HTML,
  });
  assert.deepEqual(r, {
    kind: "sale",
    venue: "poshmark",
    orderRef: "0123456789abcdef01234567",
    lines: [
      {
        title: "Dabo Swinney Signed Clemson Tigers Framed Photo Howards Rock Autograph VG+",
        titleTruncated: false,
        venueListingId: null,
        price: 24,
      },
    ],
  });
});

test("poshmark: bundle lists one line per item", () => {
  const html = `<table>
    <tr><td>Order ID</td></tr><tr><td>fedcba9876543210fedcba98</td></tr>
    <tr><td>First Item Title</td></tr><tr><td>Size: OS</td></tr><tr><td>Price: $10.00</td></tr>
    <tr><td>Second Item Title</td></tr><tr><td>Size: M</td></tr><tr><td>Price: $12.50</td></tr>
  </table>`;
  const r = parseSaleEmail({
    from: "orders@poshmark.com",
    subject: "Your bundle just sold to @buyer_handle on Poshmark!",
    text: null,
    html,
  });
  assert.ok(r && r.kind === "sale");
  assert.deepEqual(
    r.lines.map((l) => [l.title, l.price]),
    [
      ["First Item Title", 10],
      ["Second Item Title", 12.5],
    ]
  );
});

test("poshmark: shipping and other mails are ignored", () => {
  assert.equal(
    parseSaleEmail({
      from: "orders@poshmark.com",
      subject: 'Thank you for shipping "Some Item"',
      text: "x",
      html: null,
    }),
    null
  );
});

// ─── Whatnot ──────────────────────────────────────────────────────────────────

test("whatnot: title from subject, price from body", () => {
  const r = parseSaleEmail({
    from: "Whatnot <orders@whatnot.com>",
    subject: "Your Vintage Two Top Mountain Montana Snowmobiles Postcard West Yellowstone ES-244 got sold! Get ready to ship it.",
    text: "Hi Todd!\n\nCongrats, your listing, Vintage Two Top Mountain Montana Snowmobiles Postcard West Yellowstone ES-244, has sold for $4.11!\n",
    html: null,
  });
  assert.deepEqual(r, {
    kind: "sale",
    venue: "whatnot",
    orderRef: null,
    lines: [
      {
        title: "Vintage Two Top Mountain Montana Snowmobiles Postcard West Yellowstone ES-244",
        titleTruncated: false,
        venueListingId: null,
        price: 4.11,
      },
    ],
  });
});

test("whatnot: cancellation mails are not sales", () => {
  assert.equal(
    parseSaleEmail({
      from: "donotreply@whatnot.com",
      subject: "You have a cancellation request",
      text: "x",
      html: null,
    }),
    null
  );
});

// ─── Depop ────────────────────────────────────────────────────────────────────

const DEPOP_TEXT = [
  "You've made a sale!",
  "Order details",
  "image Spider-Man 3 Movie Poster Venom Sandman New...",
  "",
  "$6.99",
  " Ship to",
  "",
  "Pat Example",
  "1 Example St",
  "Buyer",
  "buyer_handle",
  "Payment details",
  "Item price",
  "$6.99",
].join("\r\n");

const DEPOP_HTML = `<table><tr><td>You've made a sale!</td></tr>
<tr><td>Order details</td></tr>
<tr><td><img alt="image" src="x.jpg"/></td><td>Spider-Man 3 Movie Poster Venom Sandman New...</td></tr>
<tr><td>$6.99</td></tr>
<tr><td>Ship to</td></tr><tr><td>Pat Example</td></tr>
<tr><td>Payment details</td></tr><tr><td>Item price</td></tr><tr><td>$6.99</td></tr></table>`;

for (const [label, text, html] of [
  ["text part", DEPOP_TEXT, null],
  ["HTML only", null, DEPOP_HTML],
] as const) {
  test(`depop: shortened title + price (${label})`, () => {
    const r = parseSaleEmail({
      from: "Depop <sold@alerts.depop.com>",
      subject: "Your USPS shipping label and sale confirmation for @buyer_handle.",
      text,
      html,
    });
    assert.deepEqual(r, {
      kind: "sale",
      venue: "depop",
      orderRef: null,
      lines: [
        {
          title: "Spider-Man 3 Movie Poster Venom Sandman New",
          titleTruncated: true,
          venueListingId: null,
          price: 6.99,
        },
      ],
    });
  });
}

test("depop: two items in one order", () => {
  const text = [
    "Order details",
    "image First Thing",
    "$5.00",
    "image Second Thing That Is Long...",
    "$8.00",
    "Ship to",
  ].join("\n");
  const r = parseSaleEmail({
    from: "sold@alerts.depop.com",
    subject: "Your USPS shipping label and sale confirmation for @buyer_handle.",
    text,
    html: null,
  });
  assert.ok(r && r.kind === "sale");
  assert.deepEqual(
    r.lines.map((l) => [l.title, l.titleTruncated, l.price]),
    [
      ["First Thing", false, 5],
      ["Second Thing That Is Long", true, 8],
    ]
  );
});

// ─── Nifty ────────────────────────────────────────────────────────────────────

const NIFTY_HTML = `<html><body><p>Hi Todd,</p>
<p>We detected the sale of &#34;<b>Vintage Hell in Texas Poem Postcard E. C. Kropp Co T43 Western Cowboy Art</b>&#34; on Mercari. However, we were unable to auto-delist the item on the following marketplaces:</p>
<ul>
  <li><b><a href="https://example.invalid/etsy">Etsy</a></b>: Your connection expired. To resume auto-delisting, please <a href="https://example.invalid/r">reconnect</a> at your earliest convenience.</li>
  <li><b><a href="https://example.invalid/depop">Depop</a></b>: Listing not found. Please check it.</li>
</ul>
<p>When you have a moment, please manually delist the item on <a href="https://example.invalid/etsy">Etsy</a>.</p>
<p>Thanks!</p></body></html>`;

test("nifty: failed auto-delist (HTML only)", () => {
  const r = parseSaleEmail({
    from: "Nifty <hello@nifty.ai>",
    subject: "[ACTION REQUIRED] Failed auto-delist",
    text: null,
    html: NIFTY_HTML,
  });
  assert.deepEqual(r, {
    kind: "nifty_failed_delist",
    title: "Vintage Hell in Texas Poem Postcard E. C. Kropp Co T43 Western Cowboy Art",
    soldVenue: "mercari",
    failed: [
      { venue: "etsy", reason: "Your connection expired." },
      { venue: "depop", reason: "Listing not found." },
    ],
  });
});

test("nifty: markdown-ish text part", () => {
  const text = [
    'We detected the sale of "*Some Book 1950 First Edition*" on eBay. However, we were unable to auto-adjust the item on the following marketplaces:',
    "",
    "   - *Etsy[](https://example.invalid)*: Your connection expired. To resume, reconnect.",
    "",
    "When you have a moment, please fix it.",
  ].join("\n");
  const r = parseSaleEmail({ from: "hello@nifty.ai", subject: "[ACTION REQUIRED] Failed auto-adjust", text, html: null });
  assert.ok(r && r.kind === "nifty_failed_adjust");
  assert.equal(r.title, "Some Book 1950 First Edition");
  assert.equal(r.soldVenue, "ebay");
  assert.deepEqual(r.failed, [{ venue: "etsy", reason: "Your connection expired." }]);
});

test("nifty: reconnect notice", () => {
  assert.deepEqual(
    parseSaleEmail({ from: "hello@nifty.ai", subject: "Reconnect your Poshmark account", text: "x", html: null }),
    { kind: "nifty_reconnect", venue: "poshmark" }
  );
});

// ─── helpers ──────────────────────────────────────────────────────────────────

test("unknown senders are ignored", () => {
  assert.equal(parseSaleEmail({ from: "someone@example.com", subject: "You've made a sale: x", text: "x", html: null }), null);
});

test("normalizeTitle matches the capture normalizer and drops a trailing ellipsis", () => {
  assert.equal(normalizeTitle("  Spider-Man 3  Movie Poster...  "), "spider-man 3 movie poster");
  assert.equal(normalizeTitle("Tom &amp; Jerry"), "tom & jerry");
});

test("htmlToText keeps cell boundaries as line breaks", () => {
  assert.equal(htmlToText("<tr><td>a</td></tr><tr><td>b</td></tr>"), "a\n b");
});

test("depop: clothing size lines don't replace the title", () => {
  const text = ["Order details", "image Denim & Co Light Blue Short Sleeve...", " Size:", "L", "", "$5.25", "Ship to"].join("\n");
  const r = parseSaleEmail({ from: "sold@alerts.depop.com", subject: "Your USPS shipping label and sale confirmation for @x.", text, html: null });
  assert.ok(r && r.kind === "sale");
  assert.deepEqual(r.lines.map((l) => [l.title, l.price]), [["Denim & Co Light Blue Short Sleeve", 5.25]]);
});

test("poshmark: invisible direction marks inside the subject title are removed", () => {
  const r = parseSaleEmail({
    from: "orders@poshmark.com",
    subject: '"Cintas Men\'s Design Collective\u200e Dress Pants 42x30" just sold to @buyer_handle on Poshmark!',
    text: "Hi Todd!",
    html: null,
  });
  assert.ok(r && r.kind === "sale");
  assert.equal(r.lines[0].title, "Cintas Men's Design Collective Dress Pants 42x30");
  assert.equal(normalizeTitle("Fairy\u200e Tale"), "fairy tale");
});
