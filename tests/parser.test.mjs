// Run with:  node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, findDate, parseText, parseCsv, parseLooseNumber } from '../js/parser.js';
import { categorize, merchantKey } from '../js/categorize.js';

const REF = new Date(2026, 10, 11); // 11 Nov 2026

test('amounts in Belgian format', () => {
  assert.equal(parseAmount('-45,20'), -45.2);
  assert.equal(parseAmount('1.234,56 €'), 1234.56);
  assert.equal(parseAmount('+ 2.500,00 EUR'), 2500);
  assert.equal(parseAmount('€ 12,50'), 12.5);
  assert.equal(parseAmount('− 9,99'), -9.99);
  assert.equal(parseAmount('12.50'), 12.5);
  assert.equal(parseAmount('04.11.2026'), null, 'a date is not an amount');
  assert.equal(parseAmount('BE68 5390 0754 7034'), null, 'an IBAN is not an amount');
});

test('loose numbers (CSV)', () => {
  assert.equal(parseLooseNumber('-1.234,56'), -1234.56);
  assert.equal(parseLooseNumber('1,234.56'), 1234.56);
  assert.equal(parseLooseNumber('-45'), -45);
  assert.equal(parseLooseNumber(''), null);
});

test('dates', () => {
  assert.equal(findDate('04/11/2026', REF).date, '2026-11-04');
  assert.equal(findDate('4-11-26', REF).date, '2026-11-04');
  assert.equal(findDate('Dinsdag 4 november', REF).date, '2026-11-04');
  assert.equal(findDate('di 4 nov.', REF).date, '2026-11-04');
  assert.equal(findDate('28 december', REF).date, '2025-12-28', 'no year and in the future -> last year');
  assert.equal(findDate('Vandaag', REF).date, '2026-11-11');
  assert.equal(findDate('Gisteren', REF).date, '2026-11-10');
  assert.equal(findDate('3 mrt 2026', REF).date, '2026-03-03');
  assert.equal(findDate('2026-02-14', REF).date, '2026-02-14');
});

test('banking-app screenshot text (OCR output)', () => {
  const text = `
09:41
Belfius
Saldo 3.245,18 €
Vandaag
Colruyt Halle -86,45 €
Netflix -13,99 €
Gisteren
Loon oktober
+ 2.850,00 €
Dinsdag 4 november
Shell Brussel
-62,10
Huur appartement Gent + 950,00
`;
  const { items, balance } = parseText(text, { ref: REF });
  assert.equal(balance, 3245.18);
  assert.equal(items.length, 5);
  assert.deepEqual(items.map((i) => [i.date, i.description, i.amount, i.sign]), [
    ['2026-11-11', 'Colruyt Halle', 86.45, -1],
    ['2026-11-11', 'Netflix', 13.99, -1],
    ['2026-11-10', 'Loon oktober', 2850, 1],
    ['2026-11-04', 'Shell Brussel', 62.1, -1],
    ['2026-11-04', 'Huur appartement Gent', 950, 1],
  ]);
});

test('credit card statement rows (PDF text)', () => {
  const text = `
BEOBANK MASTERCARD – Uittreksel
Datum Omschrijving Bedrag
02/10/2026 DELHAIZE LEUVEN 54,30
03/10/2026 BOL.COM 129,99
05/10/2026 UW BETALING - DANK U -450,00
Nieuw saldo 1.234,00
`;
  const { items } = parseText(text, { ref: REF, accountType: 'credit' });
  assert.equal(items.length, 3);
  assert.equal(items[0].description, 'DELHAIZE LEUVEN');
  assert.equal(items[0].date, '2026-10-02');
  assert.equal(items[0].sign, -1);
  assert.equal(items[2].amount, 450);
});

test('CSV export with preamble (Belfius-like)', () => {
  const csv = `Rekening;BE00 0000 0000 0000
Laatste saldo;1.000,00
Rekening;Boekingsdatum;Rekeninguittrekselnummer;Transactienummer;Rekening tegenpartij;Naam tegenpartij bevat;Straat en nummer;Postcode en plaats;Transactie;Valutadatum;Bedrag;Devies;BIC;Landcode;Mededelingen
BE00;03/11/2026;1;1;;COLRUYT;;;"BETALING MET DEBETKAART";03/11/2026;-45,20;EUR;;;
BE00;25/10/2026;1;2;BE11;WERKGEVER NV;;;"OVERSCHRIJVING";25/10/2026;2.850,00;EUR;;;LOON OKTOBER`;
  const { items } = parseCsv(csv, { ref: REF });
  assert.equal(items.length, 2);
  assert.equal(items[0].date, '2026-11-03');
  assert.equal(items[0].amount, 45.2);
  assert.equal(items[0].sign, -1);
  assert.match(items[1].description, /WERKGEVER NV/);
  assert.equal(items[1].sign, 1);
});

test('categorisation (Dutch merchants)', () => {
  assert.equal(categorize('COLRUYT HALLE').categoryId, 'groceries');
  assert.equal(categorize('Netflix.com').categoryId, 'subscriptions');
  assert.equal(categorize('Loon oktober', [], { sign: 1 }).categoryId, 'salary');
  assert.equal(categorize('Huur appartement', [], { sign: 1 }).categoryId, 'rental');
  assert.equal(categorize('Huur appartement', [], { sign: -1 }).categoryId, 'housing');
  assert.equal(categorize('Afrekening Beobank Mastercard', [], { accountType: 'checking', sign: -1 }).type, 'transfer');
  assert.equal(categorize('Engie Electrabel voorschot').categoryId, 'utilities');
  assert.equal(categorize('Uber Eats Gent').categoryId, 'restaurants');
  assert.equal(categorize('Mijn winkel', [{ pattern: 'mijn winkel', categoryId: 'shopping', type: 'expense' }]).categoryId, 'shopping');
  assert.equal(merchantKey('BETALING MET DEBETKAART 03/11 COLRUYT HALLE'), 'colruyt halle');
});

test('real OCR output of a banking-app screenshot (merchant above amount, icon noise)', () => {
  const text = [
    'Zichtrekening Belfius', '', 'Saldo 3.245,18 €', '', 'VANDAAG',
    'Colruyt Halle                           _', '',
    'CO)  Betaling met debetkaart                   86,45 €',
    'Netflix                                     i)', '',
    'CO)   Domiciliëring                                 13,99 ©', '', 'GISTEREN', 'Loon oktober', '',
    '®  Werkgever NV                       +2.850,00 €',
    'Shell Brussel                           _', '',
    '®  Betaling met debetkaart                    62,10 €', '', 'DINSDAG 4 NOVEMBER', 'Afrekening Beobank', '',
    'OO  Mastercard                            -743,20 €', 'Europese domiciliëring', 'Uber Eats                                _', '',
    '®   Betaling                                       27,80 €', 'Huur appartement Gent', '',
    '5  Overschrijving van huurder            +950,00 €',
  ].join('\n');
  const { items, balance } = parseText(text, { ref: REF });
  assert.equal(balance, 3245.18);
  assert.deepEqual(items.map((i) => [i.date, i.description, i.amount, i.sign]), [
    ['2026-11-11', 'Colruyt Halle', 86.45, -1],
    ['2026-11-11', 'Netflix', 13.99, -1],
    ['2026-11-10', 'Loon oktober – Werkgever NV', 2850, 1],
    ['2026-11-10', 'Shell Brussel', 62.1, -1],
    ['2026-11-04', 'Afrekening Beobank – Mastercard', 743.2, -1],
    ['2026-11-04', 'Uber Eats', 27.8, -1],
    ['2026-11-04', 'Huur appartement Gent – Overschrijving van huurder', 950, 1],
  ]);
  assert.equal(categorize(items[4].description, [], { accountType: 'checking', sign: -1 }).type, 'transfer');
  assert.equal(categorize(items[2].description, [], { sign: 1 }).categoryId, 'salary');
  assert.equal(categorize(items[6].description, [], { sign: 1 }).categoryId, 'rental');
});

test('Kinepolis is leisure, not insurance', () => {
  assert.equal(categorize('KINEPOLIS GENT').categoryId, 'leisure');
});
