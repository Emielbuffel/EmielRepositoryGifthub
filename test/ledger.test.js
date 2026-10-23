import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAccount, summarize, classify } from '../src/core/ledger.js';
import { guessDate, dateFromName, fileKind } from '../src/core/importer.js';

const NL = `Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id
02-10-2026,09:01,01-10-2026,,,iDEAL storting,,EUR,"5000,00",EUR,"5000,00",
05-10-2026,15:31,05-10-2026,APPLE INC. - COMMON ST,US0378331005,"Koop 10 @ 250,5 USD",,USD,"-2505,00",USD,"-2505,00",abc-1
05-10-2026,15:31,05-10-2026,APPLE INC. - COMMON ST,US0378331005,DEGIRO Transactiekosten en/of kosten van derden,,EUR,"-2,00",EUR,"4998,00",abc-1
05-10-2026,15:31,05-10-2026,,,Valuta Debitering,"1,1500",EUR,"-2178,26",EUR,"2819,74",
15-10-2026,07:30,14-10-2026,APPLE INC. - COMMON ST,US0378331005,Dividend,,USD,"2,30",USD,"2,30",
15-10-2026,07:30,14-10-2026,APPLE INC. - COMMON ST,US0378331005,Dividendbelasting,,USD,"-0,35",USD,"1,95",
01-10-2026,08:00,30-09-2026,,,DEGIRO Aansluitingskosten 2026 (Nasdaq - NASDAQ),,EUR,"-2,50",EUR,"4997,50",
20-10-2026,10:00,20-10-2026,,,Terugstorting,,EUR,"-1000,00",EUR,"1819,74",`;

test('DEGIRO Dutch account statement: kinds and totals', () => {
  const L = parseAccount(NL);
  assert.deepEqual(L.map(l => l.kind), ['deposit', 'buy', 'fee', 'internal', 'dividend', 'divtax', 'fee', 'withdrawal']);
  assert.equal(L[1].qty, 10); assert.equal(L[1].price, 250.5); assert.equal(L[1].cur, 'USD');
  const S = summarize(L, cur => (cur === 'USD' ? 0.9 : 1));
  assert.equal(S.tot.deposit, 5000); assert.equal(S.tot.withdrawal, -1000); assert.equal(S.tot.fee, -4.5);
  assert.ok(Math.abs(S.tot.dividend - 2.07) < 1e-9); assert.ok(Math.abs(S.tot.divtax + 0.315) < 1e-9);
  assert.equal(S.stocks[0].name, 'APPLE INC. - COMMON ST');
});

test('English descriptions', () => {
  assert.equal(classify('Sell 5 @ 120.10 USD').kind, 'sell');
  assert.equal(classify('Dividend Tax').kind, 'divtax');
  assert.equal(classify('flatex Deposit').kind, 'deposit');
  assert.equal(classify('Processed Flatex Withdrawal').kind, 'withdrawal');
  assert.equal(classify('FX Credit').kind, 'internal');
  assert.equal(classify('French Transaction Tax').kind, 'tax');
  assert.equal(classify('DEGIRO Transaction and/or third party fees').kind, 'fee');
});

test('statement date from file name or prices; file kind', () => {
  assert.equal(new Date(dateFromName('Portfolio-2026-09-30.csv') * 1000).toISOString().slice(0, 10), '2026-09-30');
  assert.equal(new Date(dateFromName('portfolio 31-08-2026.csv') * 1000).toISOString().slice(0, 10), '2026-08-31');
  const b = [{ time: 1, close: 10 }, { time: 2, close: 11 }, { time: 3, close: 12 }], c = [{ time: 1, close: 5 }, { time: 2, close: 6 }, { time: 3, close: 6 }];
  assert.equal(guessDate([{ ticker: 'A', price: 11 }, { ticker: 'B', price: 6 }], { A: b, B: c }).t, 2);
  assert.equal(fileKind(NL), 'account'); assert.equal(fileKind('Product,Symbool/ISIN,Aantal,Slotkoers'), 'holdings');
});
