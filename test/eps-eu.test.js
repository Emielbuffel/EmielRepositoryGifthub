import test from 'node:test';
import assert from 'node:assert/strict';
import { yahooEps } from '../src/data/providers.js';
import { epsPoints, enrich } from '../src/core/earnings.js';

const v = (d, x) => ({ asOfDate: d, reportedValue: { raw: x } });
const ts = (k, list) => ({ meta: { type: [k] }, [k]: list });

test('European half-year reporter: EPS from net income ÷ shares, yearly history before it', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async url => {
    if (String(url).includes('timeseries')) return new Response(JSON.stringify({ timeseries: { result: [
      ts('quarterlyNetIncomeCommonStockholders', [v('2024-06-30', 500), v('2024-12-31', 600), v('2025-06-30', 650), v('2025-12-31', 800)]),
      ts('quarterlyDilutedAverageShares', [v('2024-06-30', 100), v('2024-12-31', 100), v('2025-06-30', 100), v('2025-12-31', 100)]),
      ts('annualDilutedEPS', [v('2021-12-31', 7), v('2022-12-31', 8.5), v('2023-12-31', 10), v('2024-12-31', 11)]),
    ] } }));
    return new Response('{}', { status: 404 });
  };
  try {
    const rows = await yahooEps('NESN.SW');
    const q = rows.filter(r => !r.annual), a = rows.filter(r => r.annual);
    assert.deepEqual(q.map(r => r.eps), [5, 6, 6.5, 8]); assert.ok(q.every(r => r.half));
    assert.equal(a.length, 4);
    const e = enrich(rows); assert.equal(e[e.length - 1].ttm, 14.5); assert.ok(Math.abs(e[e.length - 1].yoy - 8 / 6 + 1) < 1e-9);
    const pts = epsPoints(rows, 'ttm'); // 3 yearly points before the half-year TTM points start
    assert.ok(pts.filter(p => p.annual).length >= 3 && pts.length >= 6);
  } finally { globalThis.fetch = real; }
});
