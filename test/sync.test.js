import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeBundles, syncable } from '../src/core/syncmerge.js';

test('per item, the newest change wins; items only on one side are copied', () => {
  const local = { 'lists.real': { t: 200, v: ['NVDA'] }, 'holdings.real': { t: 100, v: [1] }, 'cash.real': { t: 50, v: { amount: 5 } } };
  const remote = { 'lists.real': { t: 100, v: ['AAPL'] }, 'holdings.real': { t: 300, v: [2] }, 'plans.real': { t: 10, v: [] } };
  const r = mergeBundles(local, remote);
  assert.deepEqual(Object.keys(r.apply).sort(), ['holdings.real', 'plans.real']); // newer remotely, or only there
  assert.equal(r.push, true); // local has a newer watchlist and cash the sync lacks
  assert.deepEqual(r.merged['lists.real'].v, ['NVDA']); assert.deepEqual(r.merged['holdings.real'].v, [2]);
});

test('a device joining for the first time takes the synced data (its defaults never overwrite yours)', () => {
  const iphone = { 'lists.real': { t: 9e12, v: ['default'] }, 'drawings': { t: 5, v: { X: 1 } } };
  const synced = { 'lists.real': { t: 100, v: ['my real list'] } };
  const r = mergeBundles(iphone, synced, { joining: true });
  assert.deepEqual(r.apply['lists.real'].v, ['my real list']);
  assert.deepEqual(r.merged.drawings.v, { X: 1 }); assert.equal(r.push, true); // what only the iPhone has is added
});

test('nothing to do when both sides are equal; caches, scans and secrets stay local', () => {
  const a = { 'lists.real': { t: 1, v: [1] } };
  const r = mergeBundles(a, { 'lists.real': { t: 1, v: [1] } });
  assert.equal(r.push, false); assert.deepEqual(r.apply, {});
  assert.equal(syncable('settings'), false); assert.equal(syncable('screen.free'), false); assert.equal(syncable('sync.mtimes'), false);
  assert.equal(syncable('holdings.real'), true); assert.equal(syncable('ledger.real'), true); assert.equal(syncable('strategy'), true);
});
