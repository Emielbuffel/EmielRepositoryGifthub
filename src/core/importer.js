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
  const rows = [];
  for (const line of lines.slice(1)) {
    const c = splitLine(line, d);
    const qty = num(c[ix.qty]); if (!qty) continue;
    let sym = ix.sym >= 0 ? c[ix.sym] : '', isin = ix.isin >= 0 && ix.isin !== ix.symisin ? c[ix.isin] : '';
    if (ix.symisin >= 0) { const v = c[ix.symisin] || ''; if (/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(v)) isin = v; else sym = sym || v; }
    // DEGIRO puts the currency inside the closing-price cell ("USD 225.07") or next to it
    const priceCell = ix.price >= 0 ? c[ix.price] : '';
    const curMatch = /\b([A-Z]{3}|GBX)\b/.exec(priceCell || '');
    rows.push({
      name: ix.name >= 0 ? c[ix.name] : '', sym: (sym || '').toUpperCase().trim(), isin: (isin || '').toUpperCase().trim(), qty,
      price: num(priceCell), cost: ix.cost >= 0 ? num(c[ix.cost]) : null,
      cur: ix.cur >= 0 ? (c[ix.cur] || '').toUpperCase() : curMatch ? curMatch[1] : '',
    });
  }
  if (!rows.length) throw new Error('No positions with a quantity were found.');
  return rows;
}

/** Fills in app tickers from a directory of [sym, name, isin] rows (by ISIN, then exact ticker, then name). */
export function resolveTickers(rows, directory) {
  const byIsin = new Map(), bySym = new Set(), byName = new Map();
  const fold = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\b(INC|CORP|CORPORATION|LTD|PLC|NV|SA|AG|SE|CO|HOLDINGS?|GROUP|CLASS [A-C])\b|[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  directory.forEach(([s, n, isin]) => { if (isin) byIsin.set(isin.toUpperCase(), s); bySym.add(s.toUpperCase()); const f = fold(n); if (f && !byName.has(f)) byName.set(f, s); });
  return rows.map(r => {
    let t = r.isin && byIsin.get(r.isin) || (r.sym && bySym.has(r.sym) ? r.sym : '') || byName.get(fold(r.name)) || '';
    return { ...r, ticker: t, matched: !!t };
  });
}
