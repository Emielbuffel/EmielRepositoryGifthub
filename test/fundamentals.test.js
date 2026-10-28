import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSecFundamentals, parseYahooFundamentals, ttm, margins, yoy } from '../src/core/fundamentals.js';

const F = (start, end, val, form = '10-Q', filed) => ({ start, end, val, form, filed: filed || end.replace(/-\d\d$/, '-28') });
const I = (end, val) => ({ end, val, form: '10-Q', filed: end.replace(/-\d\d$/, '-28') });

test('SEC: quarters from 3-month and year-to-date figures, Q4 from the year, balance items', () => {
  const doc = { facts: { 'us-gaap': {
    Revenues: { units: { USD: [F('2025-01-01', '2025-03-31', 100), F('2025-04-01', '2025-06-30', 110), F('2025-07-01', '2025-09-30', 120), F('2025-01-01', '2025-12-31', 460, '10-K', '2026-02-20')] } },
    NetIncomeLoss: { units: { USD: [F('2025-01-01', '2025-03-31', 10), F('2025-04-01', '2025-06-30', 12), F('2025-07-01', '2025-09-30', 13), F('2025-01-01', '2025-12-31', 50, '10-K', '2026-02-20')] } },
    // cash flow only year-to-date
    NetCashProvidedByUsedInOperatingActivities: { units: { USD: [F('2025-01-01', '2025-03-31', 20), F('2025-01-01', '2025-06-30', 45), F('2025-01-01', '2025-09-30', 70), F('2025-01-01', '2025-12-31', 100, '10-K', '2026-02-20')] } },
    PaymentsToAcquirePropertyPlantAndEquipment: { units: { USD: [F('2025-01-01', '2025-03-31', 5), F('2025-01-01', '2025-06-30', 10)] } },
    LongTermDebt: { units: { USD: [I('2025-03-31', 300), I('2025-06-30', 280)] } },
    CashAndCashEquivalentsAtCarryingValue: { units: { USD: [I('2025-03-31', 50)] } },
  } } };
  const { rows, cur } = parseSecFundamentals(doc);
  assert.equal(cur, 'USD');
  assert.deepEqual(rows.map(r => r.end), ['2025-03-31', '2025-06-30', '2025-09-30', '2025-12-31']);
  assert.deepEqual(rows.map(r => r.ocf), [20, 25, 25, 30]);
  assert.equal(rows[3].rev, 130); assert.equal(rows[3].net, 15);
  assert.equal(rows[1].fcf, 20); assert.equal(rows[0].debt, 300); assert.equal(rows[0].cash, 50);
  const T = ttm(rows); assert.equal(T.length, 1); assert.equal(T[0].rev, 460); assert.equal(T[0].ocf, 100);
  assert.ok(Math.abs(margins(T[0]).net - 50 / 460) < 1e-12);
});

test('Yahoo time series and year-over-year growth', () => {
  const v = (d, x) => ({ asOfDate: d, currencyCode: 'EUR', reportedValue: { raw: x } });
  const d = { timeseries: { result: [
    { meta: { type: ['quarterlyTotalRevenue'] }, quarterlyTotalRevenue: [v('2025-06-30', 100), v('2025-09-30', 105), v('2025-12-31', 110), v('2026-03-31', 115), v('2026-06-30', 130)] },
    { meta: { type: ['quarterlyCapitalExpenditure'] }, quarterlyCapitalExpenditure: [v('2026-06-30', -7)] },
    { meta: { type: ['quarterlyOperatingCashFlow'] }, quarterlyOperatingCashFlow: [v('2026-06-30', 20)] },
  ] } };
  const r = parseYahooFundamentals(d);
  assert.equal(r.cur, 'EUR'); assert.equal(r.rows.length, 5); assert.equal(r.rows[4].fcf, 13);
  assert.ok(Math.abs(yoy(r.rows, 'rev') - 0.3) < 1e-12);
});

test('SEC IFRS filer (20-F): yearly figures', async () => {
  const { parseSecFundamentals } = await import('../src/core/fundamentals.js');
  const Y = (y, v) => ({ start: `${y}-01-01`, end: `${y}-12-31`, val: v, form: '20-F', filed: `${y + 1}-04-10` });
  const doc = { facts: { 'ifrs-full': { Revenue: { units: { TWD: [Y(2023, 2.16e12), Y(2024, 2.89e12)] } }, ProfitLossAttributableToOwnersOfParent: { units: { TWD: [Y(2023, 8.4e11), Y(2024, 1.17e12)] } }, CashAndCashEquivalents: { units: { TWD: [{ end: '2024-12-31', val: 2.1e12, form: '20-F', filed: '2025-04-10' }] } } } } };
  const r = parseSecFundamentals(doc);
  assert.equal(r.basis, 'IFRS'); assert.equal(r.cur, 'TWD'); assert.equal(r.rows.length, 0);
  assert.deepEqual(r.annual.map(x => x.end), ['2023-12-31', '2024-12-31']); assert.equal(r.annual[1].cash, 2.1e12);
});

test('Yahoo profile and the funds item', async () => {
  const { parseYahooProfile } = await import('../src/data/company.js').catch(() => ({}));
  if (!parseYahooProfile) return; // browser-only imports
  const p = parseYahooProfile({ quoteSummary: { result: [{ assetProfile: { sector: 'Consumer Cyclical', industry: 'Furnishings' }, defaultKeyStatistics: { heldPercentInstitutions: { raw: 0.62 }, floatShares: { raw: 9e7 } }, financialData: { returnOnEquity: { raw: 0.21 } }, price: { longName: 'SharkNinja, Inc.', currency: 'USD' } }] } });
  assert.equal(p.name, 'SharkNinja, Inc.'); assert.equal(p.inst, 0.62); assert.equal(p.roe, 0.21);
});

test('fundSummary: growth, acceleration, margins', async () => {
  const { fundSummary } = await import('../src/core/fundamentals.js');
  const ends = ['2024-03-31', '2024-06-30', '2024-09-30', '2024-12-31', '2025-03-31', '2025-06-30', '2025-09-30', '2025-12-31'];
  const eps = [1, 1, 1, 1, 1.1, 1.2, 1.4, 1.6], rows = ends.map((end, i) => ({ end, eps: eps[i], rev: 100 + i * 10, net: 10 + i, fcf: 5, debt: 50, equity: 100 }));
  const s = fundSummary({ rows, annual: [] });
  assert.ok(Math.abs(s.eg - 0.6) < 1e-9); assert.equal(s.acc, true); assert.equal(s.de, 0.5);
  assert.ok(Math.abs(s.sg - 40 / 130) < 1e-9);
});
