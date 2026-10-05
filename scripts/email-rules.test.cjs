// node --test --test-isolation=none scripts/email-rules.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');

const code = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../lib/email/rules.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
).outputText;
const ctx = { exports: {}, require: (n) => { throw Error(n); } };
vm.runInNewContext(code, ctx);
const r = ctx.exports;
const DOMAINS = ['foundinalabama.com', 'theephemeralstate.com'];

test('local part: normalizes case/space, rejects junk', () => {
  assert.equal(r.normalizeLocalPart('  Orders '), 'orders');
  assert.equal(r.normalizeLocalPart('todd.n+ebay'), 'todd.n+ebay');
  assert.equal(r.normalizeLocalPart('a..b'), null);
  assert.equal(r.normalizeLocalPart('.a'), null);
  assert.equal(r.normalizeLocalPart('has space'), null);
  assert.equal(r.normalizeLocalPart('x@y'), null);
  assert.equal(r.normalizeLocalPart(''), null);
  assert.equal(r.normalizeLocalPart('a'.repeat(65)), null);
});

test('domains: env override, default both', () => {
  assert.deepEqual([...r.emailDomains('')], DOMAINS);
  assert.deepEqual([...r.emailDomains(' A.com, b.com ')], ['a.com', 'b.com']);
});

test('validate: inbox needs no forward; forward needs a valid one; no self-forward', () => {
  const ok = r.validateAddressInput({ localPart: 'Hello', domain: 'theephemeralstate.com' }, DOMAINS);
  assert.equal(ok.ok, true);
  assert.equal(ok.value.address, 'hello@theephemeralstate.com');
  assert.equal(ok.value.mode, 'inbox');
  assert.equal(ok.value.forwardTo, null);

  const fwd = r.validateAddressInput(
    { localPart: 'buy', domain: 'foundinalabama.com', mode: 'forward', forwardTo: ' Me@Gmail.com ', label: ' auctions ' },
    DOMAINS
  );
  assert.equal(fwd.ok, true);
  assert.equal(fwd.value.forwardTo, 'me@gmail.com');
  assert.equal(fwd.value.label, 'auctions');

  assert.equal(r.validateAddressInput({ localPart: 'a', domain: 'evil.com' }, DOMAINS).ok, false);
  assert.equal(r.validateAddressInput({ localPart: 'a', domain: 'foundinalabama.com', mode: 'both', forwardTo: 'nope' }, DOMAINS).ok, false);
  assert.equal(r.validateAddressInput({ localPart: 'a', domain: 'foundinalabama.com', mode: 'bogus' }, DOMAINS).ok, false);
  assert.equal(
    r.validateAddressInput({ localPart: 'a', domain: 'foundinalabama.com', mode: 'forward', forwardTo: 'a@foundinalabama.com' }, DOMAINS).ok,
    false
  );
});

test('buildRule: forward → native forward; inbox/both → worker', () => {
  const f = r.buildRule({ address: 'a@x.com', mode: 'forward', forwardTo: 'me@gmail.com', enabled: true });
  assert.deepEqual(JSON.parse(JSON.stringify(f)), {
    name: 'FiA admin: a@x.com',
    enabled: true,
    matchers: [{ type: 'literal', field: 'to', value: 'a@x.com' }],
    actions: [{ type: 'forward', value: ['me@gmail.com'] }],
  });
  const i = r.buildRule({ address: 'a@x.com', mode: 'both', forwardTo: 'me@gmail.com', enabled: false });
  assert.deepEqual(JSON.parse(JSON.stringify(i.actions)), [{ type: 'worker', value: ['fia-inbox'] }]);
  assert.equal(i.enabled, false);
});

test('classifyRule: round-trips our rules, skips drop/catch-all/other workers', () => {
  const f = r.classifyRule(r.buildRule({ address: 'a@x.com', mode: 'forward', forwardTo: 'me@gmail.com', enabled: true }));
  assert.equal(f.ok, true);
  assert.equal(f.mode, 'forward');
  assert.equal(f.forwardTo, 'me@gmail.com');
  const w = r.classifyRule(r.buildRule({ address: 'B@x.com', mode: 'inbox', forwardTo: null, enabled: false }));
  assert.equal(w.ok, true);
  assert.equal(w.mode, 'inbox');
  assert.equal(w.address, 'b@x.com');
  assert.equal(w.enabled, false);
  assert.equal(r.classifyRule({ matchers: [{ type: 'all' }], actions: [{ type: 'forward', value: ['me@gmail.com'] }] }).ok, false);
  assert.equal(r.classifyRule({ matchers: [{ type: 'literal', field: 'to', value: 'a@x.com' }], actions: [{ type: 'drop' }] }).ok, false);
  assert.equal(r.classifyRule({ matchers: [{ type: 'literal', field: 'to', value: 'a@x.com' }], actions: [{ type: 'worker', value: ['other'] }] }).ok, false);
});

test('inboundDecision: store/forward per mode; unknown recipients stored', () => {
  assert.deepEqual({ ...r.inboundDecision(null) }, { store: true, forwardTo: null });
  assert.deepEqual({ ...r.inboundDecision({ mode: 'inbox', forwardTo: null, enabled: true }) }, { store: true, forwardTo: null });
  assert.deepEqual({ ...r.inboundDecision({ mode: 'both', forwardTo: 'me@gmail.com', enabled: true }) }, { store: true, forwardTo: 'me@gmail.com' });
  assert.deepEqual({ ...r.inboundDecision({ mode: 'forward', forwardTo: 'me@gmail.com', enabled: true }) }, { store: false, forwardTo: 'me@gmail.com' });
});

test('splitAddress', () => {
  assert.deepEqual({ ...r.splitAddress('Orders@TheEphemeralState.com') }, { localPart: 'orders', domain: 'theephemeralstate.com' });
  assert.equal(r.splitAddress('nope'), null);
});
