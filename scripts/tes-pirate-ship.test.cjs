// node --test --test-isolation=none scripts/tes-pirate-ship.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');

const code = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../lib/tes/pirate-ship.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
).outputText;
const ctx = { exports: {}, require: (n) => { throw Error(n); } };
vm.runInNewContext(code, ctx);
const ps = ctx.exports;

const ID = '3f2c9a10-1b2c-4d5e-8f90-a1b2c3d4e5f6';
const order = {
  id: ID,
  shippingName: 'Jane "JJ" Doe',
  email: 'jane@example.com',
  shippingAddress: { line1: '12 Oak St', line2: 'Apt 4, Rear', city: 'Lineville', state: 'AL', postal_code: '36266', country: 'US' },
  items: [
    { sku: '12', title: 'Menu', quantity: 1, shipClass: 'paper' },
    { sku: '12', title: 'Program', quantity: 1, shipClass: 'paper' },
    { sku: '31', title: 'Book', quantity: 1, shipClass: 'media' },
  ],
};

test('package estimate: heaviest class governs, extras add their own increment', () => {
  const p = ps.estimatePackage(order.items);
  assert.equal(p.shipClass, 'media');
  assert.equal(p.weightOz, 16 + 0.5 + 0.5);
  assert.equal(p.lengthIn, 10);
  assert.equal(ps.estimatePackage([]).shipClass, 'paper');
});

test('CSV out: stable headers, quoting, bins stamp, round-trips through parser', () => {
  const csv = ps.buildPirateShipCsv([order]);
  const rows = ps.parseCsv(csv);
  assert.equal(JSON.stringify(rows[0]), JSON.stringify(ps.PIRATE_SHIP_HEADERS));
  const r = rows[1];
  assert.equal(r[0], ID);
  assert.equal(r[1], 'Jane "JJ" Doe');
  assert.equal(r[3], 'Apt 4, Rear');
  assert.equal(r[6], '36266');
  assert.equal(r[13], 'Bins: 12×2, 31');
  assert.equal(r[14], 'TES #3f2c9a10');
  assert.equal(r[15], '3 items · media');
  assert.ok(r.slice(13).every((s) => s.length <= ps.STAMP_MAX));
});

test('CSV out neutralizes formula injection', () => {
  const csv = ps.buildPirateShipCsv([{ ...order, shippingName: '=HYPERLINK("x")' }]);
  assert.equal(ps.parseCsv(csv)[1][1], `'=HYPERLINK("x")`);
});

test('tracking in: by Order ID, skips voided, guesses carrier', () => {
  const csv = [
    'Created Date,Recipient,Zipcode,Order ID,Carrier,Tracking Number,Status',
    `2026-09-25,Jane Doe,36266,${ID.toUpperCase()},USPS,9400 1000 0000 0000 0000 00,Delivered`,
    '2026-09-25,Bob,35203,,USPS,9400100000000000000011,Voided',
    '2026-09-25,Ann Lee,35203-1234,,,9400100000000000000022,Label Created',
  ].join('\n');
  const out = ps.extractTracking(csv);
  assert.equal(out.ok, true);
  assert.equal(out.voidedSkipped, 1);
  assert.equal(out.rows.length, 2);
  assert.equal(out.rows[0].orderId, ID);
  assert.equal(out.rows[0].tracking, '9400100000000000000000');
  assert.equal(out.rows[1].orderId, null);
  assert.equal(out.rows[1].name, 'Ann Lee');
  assert.equal(out.rows[1].zip5, '35203');
  assert.equal(out.rows[1].carrier, 'USPS');
});

test('tracking in: rejects files without a tracking column', () => {
  assert.equal(ps.extractTracking('Name,Zip\nA,1').ok, false);
  assert.equal(ps.extractTracking('').ok, false);
});

test('tracking URLs', () => {
  assert.match(ps.trackingUrl('1Z999AA10123456784', null), /ups\.com/);
  assert.match(ps.trackingUrl('9400100000000000000000', 'USPS'), /usps\.com/);
  assert.equal(ps.normName('Jane  Doe-Smith'), 'janedoesmith');
});
