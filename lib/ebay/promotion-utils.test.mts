import test from 'node:test';
import assert from 'node:assert/strict';
import { promotionText, promotionDescription, promotionIdFromLocation, promotionMatchKey, saleChanged, renewalStart, remoteSaleStatus } from './promotion-utils.ts';

test('real failed category names produce plain descriptions within eBay limit', () => {
  for (const name of [
    'Vinyl / Records › LPs › Southern Gospel LPs 20% off',
    'Vinyl / Records › LPs › Soul, Funk, &amp; R&amp;B LPs 20% off',
    'Tools &amp; Hardware › Vintage Tools &amp; Hardware 20% off',
    'Vintage Photography › Vintage Transportation Photos 20% off',
    'A'.repeat(100), '🎁 Café &amp; Antiques',
  ]) {
    const description = promotionDescription(name);
    assert.ok(description.length > 0 && description.length <= 50);
    assert.match(description, /^[\x20-\x7e]+$/);
    assert.doesNotMatch(description, /[&<>"']/);
  }
  assert.equal(promotionText('Tools &amp; Hardware &#8211; 20% off', 90), 'Tools & Hardware - 20% off');
});

test('creation ID comes from Location even when response has no body', () => {
  assert.equal(promotionIdFromLocation('https://api.ebay.com/sell/marketing/v1/item_price_markdown/1217296127802'), '1217296127802');
  assert.equal(promotionIdFromLocation('/sell/marketing/v1/item_price_markdown/123?foo=bar'), '123');
  assert.equal(promotionIdFromLocation(null), null);
  assert.equal(promotionIdFromLocation('/sell/marketing/v1/promotion'), null);
});

test('historical recovery keys match timezone and subsecond representations but not different events', () => {
  const a = promotionMatchKey('Test', '2026-08-25T14:34:00.111Z', '2026-09-24T14:34:00.111Z');
  const b = promotionMatchKey('Test', '2026-08-25T07:34:00-07:00', '2026-09-24T14:34:00Z');
  assert.equal(a, b);
  assert.notEqual(a, promotionMatchKey('Test', '2026-08-26T14:34:00Z', '2026-09-24T14:34:00Z'));
});

test('sync notices changed dates even when status stays scheduled', () => {
  const local = { status: 'SCHEDULED', ebayPromotionId: '123', startsAt: new Date('2026-09-27T10:00Z'), endsAt: new Date('2026-10-27T10:00Z'), lastError: null };
  const remote = { promotionStatus: 'SCHEDULED', promotionId: '123', startDate: local.startsAt.toISOString(), endDate: local.endsAt.toISOString() };
  assert.equal(saleChanged(local, remote), false);
  assert.equal(saleChanged(local, { ...remote, endDate: '2026-10-28T10:00Z' }), true);
  assert.equal(saleChanged({ ...local, ebayPromotionId: null }, remote), true);
  assert.equal(remoteSaleStatus('ENDED'), 'ENDED');
  assert.equal(remoteSaleStatus('unexpected'), null);
});

test('renewal starts at previous expiry without a one-day gap or overlap', () => {
  const now = new Date('2026-09-22T14:00Z');
  const end = new Date('2026-09-24T14:34Z');
  assert.equal(+renewalStart(now, end), +end);
  assert.equal(+renewalStart(new Date(+end + 1000), end), +end + 301000);
});
