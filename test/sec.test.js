import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFacts, listedCommon } from '../src/data/sec.js';

const f = (start, end, val, filed, fy, fp, form = '10-Q') => ({ start, end, val, filed, fy, fp, form });
// Fiscal year Feb–Jan, a 10-for-1 split on 2024-06-10. Q1 FY2024 was only ever filed before the split (0.82);
// Q1 FY2025 was filed at 5.98 before the split and restated at 0.60 in the next year's 10-Q.
const doc = { facts: { 'us-gaap': {
  EarningsPerShareDiluted: { units: { 'USD/shares': [
    f('2023-01-30', '2023-04-30', 0.82, '2023-05-26', 2024, 'Q1'),
    f('2023-05-01', '2023-07-30', 2.48, '2023-08-28', 2024, 'Q2'),
    f('2023-07-31', '2023-10-29', 3.71, '2023-11-21', 2024, 'Q3'),
    f('2023-01-30', '2024-01-28', 11.93, '2024-02-21', 2024, 'FY', '10-K'),
    f('2024-01-29', '2024-04-28', 5.98, '2024-05-29', 2025, 'Q1'),
    f('2024-01-29', '2024-04-28', 0.60, '2025-05-28', 2026, 'Q1'), // restated after the split
    f('2024-04-29', '2024-07-28', 0.67, '2024-08-28', 2025, 'Q2'),
  ] } },
  Revenues: { units: { USD: [
    f('2023-01-30', '2023-04-30', 7192, '2023-05-26', 2024, 'Q1'),
    f('2024-01-29', '2024-04-28', 26044, '2024-05-29', 2025, 'Q1'),
  ] } },
} } };
const splits = [{ time: Date.parse('2024-06-10') / 1000, ratio: 10 }];

test('parseFacts: split-adjusts old filings, keeps restated values, derives Q4', () => {
  const r = parseFacts(doc, splits);
  const by = Object.fromEntries(r.map(x => [x.end, x]));
  assert.equal(by['2023-04-30'].eps, 0.082);              // filed before the split: divided by 10
  assert.equal(by['2024-04-28'].eps, 0.6);                // restated after the split: as filed
  assert.equal(by['2024-07-28'].eps, 0.67);               // filed after the split: already on the new share count
  assert.equal(by['2024-01-28'].period, 'Q4 FY2024');     // derived Q4
  assert.ok(Math.abs(by['2024-01-28'].eps - (1.193 - 0.082 - 0.248 - 0.371)) < 1e-4);
  assert.ok(by['2024-01-28'].derived);
  assert.equal(by['2023-04-30'].rev, 7192);
  assert.equal(by['2024-04-28'].time, Date.parse('2024-05-29') / 1000); // first filing date = report date
  assert.deepEqual(r.map(x => x.end), ['2023-04-30', '2023-07-30', '2023-10-29', '2024-01-28', '2024-04-28', '2024-07-28']);
});

test('listedCommon keeps one Nasdaq/NYSE common ticker per company', () => {
  const l = listedCommon([
    { cik: 1, s: 'BRK-B', x: 'NYSE' }, { cik: 1, s: 'BRK-A', x: 'NYSE' }, { cik: 2, s: 'BAC-PL', x: 'NYSE' },
    { cik: 3, s: 'NVDA', x: 'Nasdaq' }, { cik: 4, s: 'OTCX', x: 'OTC' }, { cik: 5, s: 'ABCDW', x: 'Nasdaq' },
  ]);
  assert.deepEqual(l.map(x => x.s), ['BRK-B', 'NVDA', 'ABCDW']);
});
