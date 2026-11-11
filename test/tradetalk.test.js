import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTrades, parseNum, findSymbol, settlePrice, looksLikeTrades } from '../src/core/tradetalk.js';

const today = Date.UTC(2026, 10, 11, 15);
const day = t => new Date(t * 1000).toISOString().slice(0, 10);
const one = s => { const r = parseTrades(s, today); assert.equal(r.length, 1, s); return r[0]; };

test('numbers in English and Dutch notation', () => {
  assert.equal(parseNum('1.432,29'), 1432.29); assert.equal(parseNum('1,432.29'), 1432.29);
  assert.equal(parseNum('98,40'), 98.4); assert.equal(parseNum('12.800'), 12800); assert.equal(parseNum('182.30'), 182.3);
});

test('English trades', () => {
  let t = one('bought 50 NVDA at 182.30 yesterday');
  assert.deepEqual([t.side, t.qty, t.name, t.price, day(t.t)], ['buy', 50, 'NVDA', 182.3, '2026-11-10']);
  t = one('sold 20 ASML for 12.800 euro in total');
  assert.deepEqual([t.side, t.qty, t.total, t.cur], ['sell', 20, 12800, 'EUR']);
  assert.equal(settlePrice(t, 650).price, 640);
  const two = parseTrades('I added 30 shares of Meta @ 641 on 3 Nov and sold half of my LLY at 1432', today);
  assert.deepEqual(two.map(x => [x.side, x.qty ?? x.frac, x.name, x.price, day(x.t)]), [['buy', 30, 'Meta', 641, '2026-11-03'], ['sell', 0.5, 'LLY', 1432, '2026-11-11']]);
  t = one('sold all my Tesla at 412 today'); assert.deepEqual([t.side, t.frac, t.name], ['sell', 1, 'Tesla']);
});

test('Dutch trades, fees and currencies', () => {
  let t = one('Gisteren 100 UCB gekocht aan 180,5 euro, kosten 3 euro');
  assert.deepEqual([t.side, t.qty, t.name, t.price, t.cur, t.fee, day(t.t)], ['buy', 100, 'UCB', 180.5, 'EUR', 3, '2026-11-10']);
  t = one('kocht 120 Siemens Energy aan €98,40'); assert.deepEqual([t.name, t.price, t.cur], ['Siemens Energy', 98.4, 'EUR']);
  t = one('verkocht de helft van mijn ASML aan 640'); assert.deepEqual([t.side, t.frac, t.name, t.price], ['sell', 0.5, 'ASML', 640]);
  t = one('koop 10 ASML.AS 650 per stuk'); assert.deepEqual([t.name, t.price], ['ASML.AS', 650]);
  const two = parseTrades('bought 15 shares of Novo Nordisk at 412 DKK and 10 Adyen at 1.432,29 euro', today);
  assert.deepEqual(two.map(x => [x.name, x.price, x.cur]), [['Novo Nordisk', 412, 'DKK'], ['Adyen', 1432.29, 'EUR']]);
});

test('"for 12500": per share or in total, decided by the price', () => {
  const t = one('bought 25 microsoft for 12500 dollar');
  assert.equal(settlePrice({ ...t }, 510).price, 500);
  assert.equal(settlePrice({ ...t, ambiguous: 505 }, 510).price, 505);
});

test('questions are not trades; names become tickers', () => {
  assert.equal(looksLikeTrades('Should I buy NVDA at 180?'), false);
  assert.equal(looksLikeTrades('bought 50 NVDA at 182'), true);
  const L = [['NVDA', 'NVIDIA Corporation'], ['ENR.DE', 'Siemens Energy AG'], ['UCB.BR', 'UCB SA'], ['MSFT', 'Microsoft Corporation'], ['LLY', 'Eli Lilly and Company']];
  assert.equal(findSymbol('Siemens Energy', L).sym, 'ENR.DE');
  assert.equal(findSymbol('UCB', L).sym, 'UCB.BR');
  assert.equal(findSymbol('microsoft', L).sym, 'MSFT');
  assert.equal(findSymbol('Lilly', L).sym, 'LLY');
  assert.equal(findSymbol('Nonexistent Co', L), null);
});
