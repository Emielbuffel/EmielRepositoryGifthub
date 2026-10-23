// Reads holdings from a broker export (CSV or text copied from a statement). Recognises column names in
// English, Dutch, French and German, e.g. DEGIRO "Portfolio.csv" (Product, Symbol/ISIN, Amount, Closing, Value in EUR).

/** Splits one CSV line, respecting quotes. */
function splitLine(line, d) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (ch === d && !q) { out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** "1.234,56" / "1,234.56" / "1234.56" / "€ 1 234,56" -> number */
export function num(s) {
  if (s == null) return null;
  let t = String(s).replace(/[^\d,.\-]/g, '');
  if (!t || t === '-' ) return null;
  const lc = t.lastIndexOf(','), ld = t.lastIndexOf('.');
  if (lc > ld) t = t.replace(/\./g, '').replace(',', '.'); // comma is the decimal separator
  else t = t.replace(/,/g, '');
  const v = parseFloat(t); return isFinite(v) ? v : null;
}

const COLS = {
  sym: /^(symbol|ticker|code|symbool|symbole|kürzel|kuerzel)$/i,
  symisin: /symbo[lo]?l?\s*\/\s*isin|symbool\s*\/\s*isin/i,
  isin: /^isin$|isin/i,
  name: /^(product|produit|produkt|name|naam|nom|description|omschrijving|security|instrument|stock|aandeel)$/i,
  qty: /^(quantity|qty|shares|amount|aantal|nombre|quantité|quantite|anzahl|stück|stueck|units|position)$/i,
  price: /^(closing|close|price|last|koers|slotkoers|cours|kurs|last price|current price)$/i,
  cost: /(avg|average|gemiddelde|gak|aankoop|cost|prix de revient|pru|einstand|book cost|purchase price)/i,
  cur: /^(currency|ccy|valuta|devise|währung|waehrung)$/i,
};

/**
 * Parses statement text into rows {name, sym, isin, qty, price, cost, cur}.
 * Throws an Error with a readable message when no quantity column can be found.
 */
export function parseHoldings(text) {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) throw new Error('The file is empty.');
  const d = [';', '\t', ','].map(c => [c, lines[0].split(c).length]).sort((a, b) => b[1] - a[1])[0][0];
  const head = splitLine(lines[0], d).map(h => h.replace(/^"|"$/g, ''));
  const find = re => head.findIndex(h => re.test(h));
  const ix = {
    sym: find(COLS.sym), symisin: find(COLS.symisin), isin: find(COLS.isin), name: find(COLS.name),
    qty: find(COLS.qty), price: find(COLS.price), cost: find(COLS.cost), cur: find(COLS.cur),
  };
  if (ix.qty < 0) throw new Error('No quantity column found. Expected a header such as Quantity, Shares, Amount or Aantal.');
  const eurCol = head.findIndex(h => /(value|waarde|valeur|wert).*(eur)|eur.*(value|waarde)/i.test(h));
  const rows = [], cash = [];
  for (const line of lines.slice(1)) {
    const c = splitLine(line, d);
    const qty = num(c[ix.qty]);
    const nameCell = ix.name >= 0 ? c[ix.name] || '' : c[0] || '';
    if (!qty) {
      // cash lines: "CASH & CASH FUND & FTX CASH (EUR)", "Cash", "Geldmarktfonds"… (a negative amount = margin loan)
      if (/\b(cash|geld|liquidit|espèces|especes|bargeld|saldo)\b/i.test(nameCell)) {
        const nums = c.map(num).filter(v => v != null && v !== 0);
        const eur = eurCol >= 0 ? num(c[eurCol]) : null, amount = eur != null ? eur : nums.length ? nums[nums.length - 1] : null;
        const cc = (/\(([A-Z]{3})\)/.exec(nameCell) || [])[1] || c.find(x => /^[A-Z]{3}$/.test(x)) || (eurCol >= 0 ? 'EUR' : '');
        if (amount != null) cash.push({ name: nameCell, cur: eurCol >= 0 && eur != null ? 'EUR' : cc, amount });
      }
      continue;
    }
    let sym = ix.sym >= 0 ? c[ix.sym] : '', isin = ix.isin >= 0 && ix.isin !== ix.symisin ? c[ix.isin] : '';
    if (ix.symisin >= 0) { const v = c[ix.symisin] || ''; if (/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(v)) isin = v; else sym = sym || v; }
    // DEGIRO puts the currency inside the closing-price cell ("USD 225.07") or next to it
    const priceCell = ix.price >= 0 ? c[ix.price] : '';
    const curMatch = /\b([A-Z]{3}|GBX)\b/.exec(priceCell || '');
    rows.push({
      name: ix.name >= 0 ? c[ix.name] : '', sym: (sym || '').toUpperCase().trim(), isin: (isin || '').toUpperCase().trim(), qty,
      price: num(priceCell), cost: ix.cost >= 0 ? num(c[ix.cost]) : null,
      cur: ix.cur >= 0 ? (c[ix.cur] || '').toUpperCase() : curMatch ? curMatch[1] : (c.find(x => /^[A-Z]{3}$|^GBX$/.test(x)) || ''), // DEGIRO: currency in its own column
      eur: eurCol >= 0 ? num(c[eurCol]) : null,
    });
  }
  if (!rows.length && !cash.length) throw new Error('No positions with a quantity were found.');
  rows.cash = cash;
  return rows;
}

/** Holdings and cash from a statement: {rows, cash: [{name, cur, amount}], cashTotalEUR}. */
export function parseStatement(text) {
  const rows = parseHoldings(text), cash = rows.cash || [];
  return { rows, cash, cashEUR: cash.filter(x => x.cur === 'EUR').reduce((s, x) => s + x.amount, 0) };
}

/** Folds a company name for matching: no accents, punctuation or legal suffixes ("Apple Inc." → "APPLE"). */
export const foldName = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\b(INC|INCORPORATED|CORP|CORPORATION|COMPANY|LTD|LIMITED|PLC|NV|SA|AG|SE|CO|THE|AND|HOLDINGS?|GROUP|CLASS [A-C]|CL [A-C]|ORD|ADR|SHS)\b/g, '').replace(/\s+/g, ' ').trim();
// the same words in any order ("Lilly (Eli)" = "Eli Lilly")
const sortedKey = f => f.split(' ').sort().join(' ');

/** Fills in app tickers from a directory of [sym, name, isin] rows (by ISIN, then exact ticker, then name). */
export function resolveTickers(rows, directory) {
  const byIsin = new Map(), bySym = new Set(), byName = new Map(), bySorted = new Map();
  directory.forEach(([s, n, isin]) => {
    if (isin) byIsin.set(isin.toUpperCase(), s); bySym.add(s.toUpperCase());
    const f = foldName(n); if (!f) return;
    if (!byName.has(f)) byName.set(f, s);
    const k = sortedKey(f); if (!bySorted.has(k)) bySorted.set(k, s);
  });
  return rows.map(r => {
    const f = foldName(r.name);
    const t = r.isin && byIsin.get(r.isin) || (r.sym && bySym.has(r.sym) ? r.sym : '') || byName.get(f) || (f && bySorted.get(sortedKey(f))) || '';
    return { ...r, ticker: t, matched: !!t };
  });
}
