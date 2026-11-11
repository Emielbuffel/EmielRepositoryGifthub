// Reads the text of a DEGIRO PDF — the account statement ("Rekeningoverzicht" / "Account statement" /
// "Relevé de compte") — into the same cash lines as the CSV import: date, time, value date, product, ISIN,
// description, FX, change (currency + amount), balance. Each line is classified (dividend, dividend tax, costs,
// taxes such as the Belgian stock-exchange tax, interest, deposits…). Long product names that wrap onto a second
// line are joined. Lines without a date (headers, page footers) are skipped. Pure functions, tested on text lines.
import { classify, fixTrade } from './ledger.js';
import { num } from './importer.js';

const DATE = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/;
const ISIN = /\b([A-Z]{2}[A-Z0-9]{9}\d)\b/;
// a currency followed by an amount: "EUR -1,00", "USD 12.34", "EUR 1.234,56"
const MONEY = /\b(EUR|USD|GBP|GBX|CHF|SEK|NOK|DKK|PLN|CZK|HUF|JPY|HKD|CAD|AUD|SGD|KRW|CNY|TRY|ZAR|ILS|MXN)\s*(-?\s?\d[\d.,\s]*\d|-?\d)(?![\d])/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

const day = m => Date.UTC(+m[3], +m[2] - 1, +m[1]) / 1000;

/** One text line of the statement → {t, product, isin, desc, cur, amount, balance, orderId} or null. */
export function parseRow(line) {
  const s = String(line).replace(/\s+/g, ' ').trim(), d = DATE.exec(s); if (!d) return null;
  let rest = s.slice(d[0].length).trim(), t = day(d) + 12 * 3600;
  const tm = /^(\d{1,2}):(\d{2})\b/.exec(rest); if (tm) { t = day(d) + (+tm[1] * 60 + +tm[2]) * 60; rest = rest.slice(tm[0].length).trim(); }
  const vd = DATE.exec(rest); if (vd) rest = rest.slice(vd[0].length).trim(); // value date
  const uu = UUID.exec(rest), orderId = uu ? uu[0] : ''; if (uu) rest = rest.replace(uu[0], ' ').trim();
  const money = [...rest.matchAll(MONEY)];
  if (!money.length) return { t, product: '', isin: '', desc: rest, cur: null, amount: null, balance: null, orderId, open: true };
  const head = rest.slice(0, money[0].index).trim();
  const amount = num(money[0][2].replace(/\s/g, '')), balance = money[1] ? num(money[1][2].replace(/\s/g, '')) : null;
  let product = '', isin = '', desc = head;
  const im = ISIN.exec(head);
  if (im) { product = head.slice(0, im.index).trim(); isin = im[1]; desc = head.slice(im.index + im[1].length).trim(); }
  // the FX column (a rate such as 1,0834) at the end — but not the price of a trade ("Koop 10 @ 1.010")
  if (!/(@|zu je|à)\s+[\d.,]+$/i.test(desc)) desc = desc.replace(/\s+-?\d+[.,]\d{2,6}$/, '').trim();
  return { t, product, isin, desc, cur: money[0][1] === 'GBX' ? 'GBX' : money[0][1], amount, balance, orderId };
}

/**
 * All statement lines from the PDF's text lines (top to bottom). A line without a date continues the line above it
 * (wrapped product name or description). Returns ledger lines like parseAccount: {id, t, product, isin, desc, cur,
 * amount, orderId, kind, ...}.
 */
export function ledgerFromRows(rows) {
  const out = [];
  let prev = null;
  for (const raw of rows) {
    const line = String(raw).replace(/\s+/g, ' ').trim(); if (!line) continue;
    const r = parseRow(line);
    if (r) {
      if (r.amount == null) { prev = r; continue; } // the amount may follow on the next line
      prev = r; out.push(r); continue;
    }
    if (!prev) continue;
    // continuation: an amount for a dated line that had none, or more text for the product/description
    if (prev.amount == null) {
      const m = [...line.matchAll(MONEY)];
      if (m.length) { prev.amount = num(m[0][2].replace(/\s/g, '')); prev.cur = m[0][1]; prev.desc = (prev.desc + ' ' + line.slice(0, m[0].index)).trim(); out.push(prev); continue; }
      prev.desc = (prev.desc + ' ' + line).trim(); continue;
    }
    if (/^(datum|date|data|fecha|pagina|page|seite|degiro|flatex|rekeningoverzicht|account statement|relev[ée])/i.test(line) || MONEY.test(line)) { MONEY.lastIndex = 0; continue; }
    MONEY.lastIndex = 0;
    // a wrapped company name is in capitals ("SEMICONDUCTOR MANUFACTURING CO"); other wrapped text belongs to the description
    // a currency code that wrapped out of the description ("Koop 10 @ 1.100" / "EUR") is not part of the name
    const CUR = /\b(EUR|USD|GBP|GBX|CHF|SEK|NOK|DKK|PLN|CZK|HUF|JPY|HKD|CAD|AUD|SGD|KRW|CNY)\b/g, curs = line.match(CUR) || [];
    if (curs.length && !prev.pcurWrap) prev.pcurWrap = curs[0];
    const rest = line.replace(CUR, ' ').replace(/\s+/g, ' ').trim(); if (!rest) continue;
    if (prev.product && /^[A-Z0-9 .,&'()\/+-]+$/.test(rest) && /[A-Z]{2}/.test(rest)) prev.product = (prev.product + ' ' + rest).trim();
    else if (rest.length < 80) prev.desc = (prev.desc + ' ' + rest).trim();
  }
  return out.filter(r => r.amount != null && r.cur).map(r => {
    const l = { id: [r.t, r.desc, r.cur, r.amount, r.product, r.orderId].join('|'), t: r.t, product: r.product, isin: r.isin, desc: r.desc, cur: r.cur, amount: r.amount, orderId: r.orderId, src: 'pdf', ...classify(r.desc + (r.product && !r.desc ? ' ' + r.product : '')) };
    // the price currency wrapped onto the next line: use it for the trade
    if ((l.kind === 'buy' || l.kind === 'sell') && !l.pcur && r.pcurWrap) l.pcur = r.pcurWrap;
    return fixTrade(l);
  });
}

/** Country of the issuer from the ISIN (first two letters), for the dividend overview per country. */
export const isinCountry = isin => (/^[A-Z]{2}/.exec(isin || '') || [''])[0];
