// Reads a broker's account statement (cash movements), e.g. DEGIRO "Account.csv" in Dutch, English, German, French,
// Italian, Spanish or Portuguese: Date, Time, Value date, Product, ISIN, Description, FX, Change (currency, amount),
// Balance (currency, amount), Order Id. Each line is classified: deposit, withdrawal, buy/sell, dividend, dividend tax,
// transaction costs, other fees, taxes, interest, or internal (currency exchange, money-market fund, cash transfers).
import { splitLine, num } from './importer.js';

// order matters: the first match wins
const RULES = [
  ['internal', /valuta ?(creditering|debitering)|fx (credit|debit)|währungswechsel|w[äa]hrungs(gutschrift|lastschrift)|op[ée]ration de change|cambio (de )?divisa|cambio valuta|levantamento de divisa|cr[ée]dit de change|d[ée]bit de change/i],
  ['internal', /geldmarktfonds|money ?market|fonds mon[ée]taires|cash sweep|sweep|overboeking (van|naar)|transfer (from|to) your|[üu]berweisung (von|auf) ihr|productwijziging|product change|conversie|conversion/i],
  ['divtax', /dividendbelasting|dividend ?tax|dividendensteuer|quellensteuer|withholding|retenue|ritenuta|imp[ôo]t[s]? sur (les )?dividende|retenci[óo]n|da[ňn] z dividendy|imposto sobre dividendo/i],
  ['dividend', /dividend|dividende|dividendo|aussch[üu]ttung|kapitalr[üu]ckzahlung|capital return|uitkering|distribution|cupon|coupon/i],
  ['fee', /transactiekosten|transaction (and\/or|fees|costs|charges)|en\/of kosten|and\/or third|und\/oder|transaktions(geb[üu]hr|kosten)|frais de (courtage|transaction)|courtage|commissioni|comisi[óo]n|comiss[õo]es/i],
  ['fee', /aansluitingskosten|connection fee|verbindungskosten|frais de connexion|costi di connessione|custo de conectividade|adr\/gdr|pass-through fee|servicekosten|service fee|kosten|fee|geb[üu]hr|frais/i],
  ['tax', /transactiebelasting|transaction tax|stamp duty|finanztransaktionssteuer|taxe sur les transactions|tassa sulle transazioni|impuesto sobre transacciones|belasting|steuer|tax|taxe|imposto|impuesto/i],
  ['interest', /rente|interest|zinsen|int[ée]r[êe]ts|interesse|juros|inter[ée]s|courtesy/i],
  ['withdrawal', /terugstorting|withdrawal|auszahlung|retrait|prelievo|retirada|opname/i],
  ['deposit', /storting|deposit|einzahlung|versement|dep[óo]sito|ingreso|bijschrijving/i],
];
const TRADE = /(koop|buy|kauf|achat|acquisto|compra|verkoop|sell|verkauf|vente|vendita|venta)\s+([\d.,]+)\s+(?:@|zu je|à|a)\s+([\d.,]+)\s+([A-Z]{3}|GBX)/i;
const SELLW = /^(verkoop|sell|verkauf|vente|vendita|venta)$/i;

export const KIND_LABEL = { deposit: 'Deposit', withdrawal: 'Withdrawal', buy: 'Buy', sell: 'Sell', dividend: 'Dividend', divtax: 'Dividend tax', fee: 'Costs', tax: 'Tax', interest: 'Interest', internal: 'Internal (FX, cash fund, transfers)', other: 'Not recognised' };

export function classify(desc) {
  const m = TRADE.exec(desc);
  if (m) return { kind: SELLW.test(m[1]) ? 'sell' : 'buy', qty: num(m[2]), price: num(m[3]), pcur: m[4].toUpperCase() };
  for (const [k, re] of RULES) if (re.test(desc)) return { kind: k };
  return { kind: 'other' };
}

const dmy = s => { const m = /(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(s || '') || null; if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1]) / 1000; const i = /(\d{4})-(\d\d)-(\d\d)/.exec(s || ''); return i ? Date.UTC(+i[1], +i[2] - 1, +i[3]) / 1000 : null; };
const hm = s => { const m = /(\d{1,2}):(\d\d)/.exec(s || ''); return m ? (+m[1] * 60 + +m[2]) * 60 : 12 * 3600; };

/** Parses the statement into lines {id, t, product, isin, desc, cur, amount, orderId, kind, qty?, price?, pcur?}. */
export function parseAccount(text) {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) throw new Error('The account statement is empty.');
  const d = [',', ';', '\t'].map(c => [c, splitLine(lines[0], c).length]).sort((a, b) => b[1] - a[1])[0][0];
  const head = splitLine(lines[0], d).map(h => h.toLowerCase());
  const find = (re, from = 0) => { const i = head.slice(from).findIndex(h => re.test(h)); return i < 0 ? -1 : i + from; };
  const ix = {
    date: find(/^(datum|date|data|fecha)$/), time: find(/^(tijd|time|zeit|heure|ora|hora)$/), product: find(/^(product|produkt|produit|prodotto|producto|produto)$/),
    isin: find(/^isin$/), desc: find(/(omschrijving|description|beschreibung|descri)/), change: find(/(mutatie|change|änderung|mouvement|variaz|variaci|movimento)/),
    order: find(/order/),
  };
  if (ix.date < 0 || ix.desc < 0 || ix.change < 0) throw new Error('Not an account statement: expected columns such as Date, Description and Change (Datum, Omschrijving, Mutatie).');
  const out = [];
  for (const line of lines.slice(1)) {
    const c = splitLine(line, d), day = dmy(c[ix.date]); if (day == null) continue;
    // DEGIRO: "Change" holds the currency and the next (unnamed) column the amount; some exports put both in one cell
    let cur = (c[ix.change] || '').trim(), amount;
    if (/^[A-Z]{3}$/.test(cur)) amount = num(c[ix.change + 1]); else { amount = num(cur); cur = (/[A-Z]{3}/.exec(c[ix.change] || '') || ['EUR'])[0]; }
    if (amount == null) continue;
    const desc = c[ix.desc] || '', product = ix.product >= 0 ? c[ix.product] || '' : '', isin = ix.isin >= 0 ? (c[ix.isin] || '').toUpperCase() : '';
    const orderId = ix.order >= 0 ? c[ix.order] || '' : '';
    const t = day + (ix.time >= 0 ? hm(c[ix.time]) : 12 * 3600);
    out.push({ id: [t, desc, cur, amount, product, orderId].join('|'), t, product, isin, desc, cur, amount, orderId, ...classify(desc) });
  }
  if (!out.length) throw new Error('No dated lines with an amount were found in the account statement.');
  return out;
}

/**
 * Totals per kind in the base currency over [from, to], per month and per year, and dividends per stock.
 * fx: (cur, t) => base units per 1 cur.
 */
export function summarize(lines, fx, from = 0, to = Infinity) {
  const KINDS = ['dividend', 'divtax', 'fee', 'tax', 'interest', 'deposit', 'withdrawal'];
  const zero = () => Object.fromEntries(KINDS.map(k => [k, 0]));
  const tot = zero(), months = new Map(), years = new Map(), stocks = new Map(), other = [];
  for (const l of lines) {
    if (l.t < from || l.t > to) continue;
    if (l.kind === 'other') other.push(l);
    if (!KINDS.includes(l.kind)) continue;
    const v = l.amount * fx(l.cur, l.t), dt = new Date(l.t * 1000);
    const mk = dt.getUTCFullYear() + '-' + String(dt.getUTCMonth() + 1).padStart(2, '0'), yk = String(dt.getUTCFullYear());
    if (!months.has(mk)) months.set(mk, zero()); if (!years.has(yk)) years.set(yk, zero());
    tot[l.kind] += v; months.get(mk)[l.kind] += v; years.get(yk)[l.kind] += v;
    if (l.kind === 'dividend' || l.kind === 'divtax') {
      const k = l.product || l.isin || '?'; if (!stocks.has(k)) stocks.set(k, { name: k, isin: l.isin, gross: 0, tax: 0 });
      stocks.get(k)[l.kind === 'dividend' ? 'gross' : 'tax'] += v;
    }
  }
  return { tot, months: [...months].sort((a, b) => (a[0] < b[0] ? -1 : 1)), years: [...years].sort((a, b) => (a[0] < b[0] ? -1 : 1)), stocks: [...stocks.values()].sort((a, b) => b.gross - a.gross), other };
}
