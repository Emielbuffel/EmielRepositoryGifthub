import test from 'node:test';
import assert from 'node:assert/strict';
import PAT from '../src/core/pat.js';
import { demoBars } from '../src/data/demo.js';
import { screenRow } from '../src/core/analysis.js';
import { assessHolding, rankHoldings } from '../src/core/prune.js';

const one = (sym, costF = 0.9) => {
  const b = demoBars(sym).bars, R = PAT.scan(b), c = b[b.length - 1].close, row = screenRow(sym, '', b, R, null);
  return assessHolding({ sym, cost: c * costF, shares: 10 }, b, R, { sells: row ? row.sell : [] });
};

test('a loss past the stop is a sell, whatever the score', () => {
  const a = one('LUMA.DEMO', 1.2); // bought 20% higher: −17%
  assert.equal(a.verdict, 'sell'); assert.match(a.reasons[0][1], /stop/);
});

test('a leader scores higher than a stock in a downtrend', () => {
  const lead = one('LUMA.DEMO'), down = one('HAZE.DEMO');
  assert.ok(lead.score > down.score, `${lead.score} vs ${down.score}`);
  assert.notEqual(lead.verdict, 'sell');
});

test('ranking: weakest first, and how many to sell to get back to the maximum', () => {
  const items = ['LUMA.DEMO', 'HAZE.DEMO', 'ACME.DEMO', 'IRIS.DEMO'].map(s => one(s));
  const r = rankHoldings(items, { max: 3 });
  assert.equal(r.over, 1); assert.equal(r.suggest.length, 1); assert.equal(r.suggest[0], r.list[0].sym);
  assert.equal(r.list[0].sym, r.room);
  for (let i = 1; i < r.list.length; i++) {
    const O = { sell: 0, weak: 1, dead: 2, hold: 3, leader: 4 }, a = r.list[i - 1], b = r.list[i];
    assert.ok(O[a.verdict] < O[b.verdict] || (O[a.verdict] === O[b.verdict] && a.score <= b.score));
  }
});

test('a stock that hardly moved for 8 weeks is flagged as money standing still', () => {
  const bars = []; let p = 100;
  for (let i = 0; i < 300; i++) { p = i < 200 ? p * 1.001 : 120 + Math.sin(i / 3) * 0.6; bars.push({ time: 1e9 + i * 86400, open: p, high: p * 1.005, low: p * 0.995, close: p, volume: 1e6 }); }
  const a = assessHolding({ sym: 'FLAT', cost: 119, shares: 10 }, bars, PAT.scan(bars), { rs: 45 });
  assert.ok(a.reasons.some(r => /Hardly moved/.test(r[1])));
  assert.ok(['dead', 'weak', 'hold'].includes(a.verdict));
});
