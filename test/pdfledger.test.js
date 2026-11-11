import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRow, ledgerFromRows, isinCountry } from '../src/core/pdfledger.js';
import { classify } from '../src/core/ledger.js';

// text lines as pdf.js gives them for a DEGIRO account statement (Dutch), incl. a wrapped product name and a footer
const NL = [
  'Rekeningoverzicht', 'Datum Tijd Valutadatum Product ISIN Omschrijving FX Mutatie Saldo',
  '15-03-2026 07:31 14-03-2026 APPLE INC. US0378331005 Dividend USD 6,00 USD 6,00',
  '15-03-2026 07:31 14-03-2026 APPLE INC. US0378331005 Dividendbelasting USD -0,90 USD 5,10',
  '10-02-2026 15:30 10-02-2026 UCB SA BE0003739530 Koop 10 @ 250 EUR EUR -2.500,00 EUR -1.265,44 1b2c3d4e-1111-2222-3333-444455556666',
  '10-02-2026 15:30 10-02-2026 UCB SA BE0003739530 DEGIRO Transactiekosten en/of kosten van derden EUR -2,00 EUR -1.267,44',
  '10-02-2026 15:30 10-02-2026 UCB SA BE0003739530 Belgische beurstaks EUR -8,75 EUR -1.276,19',
  '02-01-2026 09:00 02-01-2026 DEGIRO Aansluitingskosten 2026 (Euronext Brussel - EBR) EUR -2,50 EUR 1.234,56',
  '20-04-2026 08:12 19-04-2026 ASML HOLDING NL0010273215 Dividend EUR 18,40 EUR 900,00',
  '20-04-2026 08:12 19-04-2026 ASML HOLDING NL0010273215 Dividendbelasting EUR -2,76 EUR 897,24',
  '01-05-2026 10:00 01-05-2026 Flatex Interest EUR -41,37 EUR 855,87',
  '03-05-2026 11:00 03-05-2026 TAIWAN SEMICONDUCTOR MANUFACTURING US8740391003 Dividend USD 9,10 USD 15,20',
  'COMPANY LTD ADR',
  'Pagina 1 van 3',
  '05-05-2026 14:00 05-05-2026 iDEAL storting EUR 5.000,00 EUR 5.855,87',
];

test('a DEGIRO statement line: date, time, product, ISIN, description, amount and balance', () => {
  const r = parseRow(NL[2]);
  assert.equal(r.product, 'APPLE INC.'); assert.equal(r.isin, 'US0378331005'); assert.equal(r.desc, 'Dividend');
  assert.equal(r.cur, 'USD'); assert.equal(r.amount, 6); assert.equal(r.balance, 6);
  assert.equal(new Date(r.t * 1000).toISOString().slice(0, 16), '2026-03-15T07:31');
  const b = parseRow(NL[4]); assert.equal(b.amount, -2500); assert.equal(b.orderId, '1b2c3d4e-1111-2222-3333-444455556666');
});

test('the whole statement: every line classified, wrapped names joined, headers and footers skipped', () => {
  const L = ledgerFromRows(NL), by = k => L.filter(l => l.kind === k);
  assert.equal(L.length, 11);
  assert.equal(by('dividend').length, 3); assert.equal(by('divtax').length, 2);
  assert.equal(by('buy').length, 1); assert.equal(by('fee').length, 2);
  const tob = L.find(l => l.sub === 'tob'); assert.ok(tob); assert.equal(tob.amount, -8.75); assert.equal(tob.kind, 'tax');
  assert.equal(by('interest')[0].amount, -41.37); assert.equal(by('deposit')[0].amount, 5000);
  const tsm = L.find(l => l.isin === 'US8740391003'); assert.equal(tsm.desc, 'Dividend'); assert.equal(tsm.amount, 9.1);
  assert.equal(tsm.product, 'TAIWAN SEMICONDUCTOR MANUFACTURING COMPANY LTD ADR');
  assert.equal(isinCountry('NL0010273215'), 'NL');
});

test('English and French statements and the stock-exchange tax in each language', () => {
  const EN = ['02/06/2026 09:31 02/06/2026 MICROSOFT CORP US5949181045 Dividend Tax USD -1.50 USD 8.50', '02/06/2026 09:31 02/06/2026 MICROSOFT CORP US5949181045 Dividend USD 10.00 USD 10.00'];
  const e = ledgerFromRows(EN); assert.deepEqual(e.map(x => x.kind), ['divtax', 'dividend']); assert.equal(e[0].amount, -1.5);
  const FR = ['12-06-2026 10:00 12-06-2026 KBC GROUPE BE0003565737 Taxe sur les opérations de bourse (TOB) EUR -4,20 EUR 100,00'];
  assert.equal(ledgerFromRows(FR)[0].sub, 'tob');
  assert.equal(classify('Stock exchange tax').sub, 'tob'); assert.equal(classify('Börsensteuer').sub, 'tob');
  assert.equal(classify('Impôts sur dividende').kind, 'divtax');
});

test('trades: Dutch thousands ("1.100" = 1,100), and a description wrapped before its currency', () => {
  const L = ledgerFromRows([
    '02-03-2026 09:05 02-03-2026 ASML HOLDING NL0010273215 Koop 10 @ 1.100 EUR EUR -11.000,00 EUR 9.000,00',
    '15-04-2026 10:10 15-04-2026 ASML HOLDING NL0010273215 Verkoop 10 @ 1.010 EUR 10.100,00 EUR 19.100,00', // "EUR" after the price wrapped away
    '02/06/2026 09:31 02/06/2026 SHOPIFY CA82509L1076 Buy 4 @ 1.25 USD USD -5.00 USD 10.00',
  ]);
  assert.deepEqual(L.map(l => [l.kind, l.qty, l.price, l.pcur]), [['buy', 10, 1100, 'EUR'], ['sell', 10, 1010, 'EUR'], ['buy', 4, 1.25, 'USD']]);
});

test('a currency that wraps onto the next PDF line is not glued to the company name', () => {
  const L = ledgerFromRows(['15-04-2026 10:10 15-04-2026 ASML HOLDING NL0010273215 Verkoop 10 @ 1.010 EUR 10.100,00 EUR 19.100,00', 'EUR', '30-06-2026 16:20 30-06-2026 META PLATFORMS NL0000000001 Verkoop 15 @ 760 USD 11.400,00 USD 1.800,00', 'INC USD']);
  assert.equal(L[0].product, 'ASML HOLDING'); assert.equal(L[1].product, 'META PLATFORMS INC'); assert.equal(L[1].pcur, 'USD');
});
