import test from 'node:test';
import assert from 'node:assert/strict';
import { setupScore } from '../src/core/score.js';
import { rankSectors } from '../src/core/sectors.js';
import { num, parseHoldings, resolveTickers } from '../src/core/importer.js';

test('setupScore: strong setup scores high, missing parts are rescaled', () => {
  const row = { p: { st: 'buyzone', bo: 2, vr: 1.8, f: false }, rs: 99, s50: 0.05, s200: 0.2, ud: 1.5 };
  const full = setupScore(row, 0.4, { us: 'up' });
  assert.equal(full.score, 100);
  assert.equal(full.parts.length, 6);
  const noEarn = setupScore(row);
  assert.equal(noEarn.parts.length, 4);
  assert.equal(noEarn.score, 100);
  const weak = setupScore({ p: null, rs: 10, s50: -0.1, s200: -0.2, ud: 0.8 }, -0.2, { us: 'corr' });
  assert.ok(weak.score < 10, `weak score ${weak.score}`);
});

test('setupScore: faulty near base scores below a sound one', () => {
  const a = setupScore({ p: { st: 'near', f: false }, rs: 80, s50: 1, s200: 1 });
  const b = setupScore({ p: { st: 'near', f: true }, rs: 80, s50: 1, s200: 1 });
  assert.ok(a.score > b.score);
  assert.match(b.parts[0][3], /faulty/);
});

test('rankSectors orders by strength and drops small groups', () => {
  const mk = (s, g, rs, s50, hi) => ({ s, g, rs, s50, hi, p: null });
  const rows = [
    mk('A', 'Tech', 95, 1, -0.02), mk('B', 'Tech', 90, 1, -0.05), mk('C', 'Tech', 85, 1, -0.1),
    mk('D', 'Utilities', 30, -1, -0.3), mk('E', 'Utilities', 20, -1, -0.4), mk('F', 'Utilities', 25, 1, -0.2),
    mk('G', 'Energy', 99, 1, 0), mk('H', 'Energy', 99, 1, 0),
  ];
  const r = rankSectors(rows);
  assert.deepEqual(r.map(x => x.g), ['Tech', 'Utilities']);
  assert.equal(r[0].rank, 1);
  assert.deepEqual(r[0].leaders, ['A', 'B', 'C']);
  assert.equal(r[0].rs, 90);
});

test('num reads European and US number formats', () => {
  assert.equal(num('1.234,56'), 1234.56);
  assert.equal(num('1,234.56'), 1234.56);
  assert.equal(num('€ 1 234,56'), 1234.56);
  assert.equal(num('USD 225.07'), 225.07);
  assert.equal(num(''), null);
});

test('parseHoldings reads a DEGIRO-style export and resolves tickers by ISIN', () => {
  const csv = 'Product;Symbool/ISIN;Aantal;Slotkoers;Waarde in EUR\n' +
    '"NVIDIA CORP";US67066G1040;10;USD 180,50;1584,63\n' +
    '"ASML HOLDING";NL0010273215;3;"650,20";1950,60\n' +
    'CASH & CASH FUND;;0;;100\n';
  const rows = parseHoldings(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].isin, 'US67066G1040');
  assert.equal(rows[0].price, 180.5);
  assert.equal(rows[0].cur, 'USD');
  assert.equal(rows[1].qty, 3);
  const dir = [['NVDA', 'NVIDIA Corporation', 'US67066G1040'], ['ASML.AS', 'ASML Holding NV', '']];
  const res = resolveTickers(rows, dir);
  assert.equal(res[0].ticker, 'NVDA');
  assert.equal(res[1].ticker, 'ASML.AS'); // matched by folded name
});

test('parseHoldings explains a missing quantity column', () => {
  assert.throws(() => parseHoldings('Name,Price\nX,1'), /quantity column/i);
});
