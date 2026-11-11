// Turns text (from OCR of screenshots, PDF statements or CSV exports) into
// transaction candidates. Built for Belgian / Dutch formats:
//   amounts  "1.234,56"  "-45,20 €"  "+ 2.500,00 EUR"  "€ 12,50"
//   dates    "04/11/2026"  "4-11-26"  "4 november 2026"  "di 4 nov"  "Vandaag"  "Gisteren"
import { todayStr } from './util.js';

const MONTHS = {
  // Dutch
  januari: 1, jan: 1, februari: 2, feb: 2, febr: 2, maart: 3, mrt: 3, maa: 3, april: 4, apr: 4, mei: 5, juni: 6, jun: 6,
  juli: 7, jul: 7, augustus: 8, aug: 8, september: 9, sep: 9, sept: 9, oktober: 10, okt: 10, november: 11, nov: 11, december: 12, dec: 12,
  // English
  january: 1, february: 2, march: 3, mar: 3, may: 5, june: 6, july: 7, august: 8, october: 10, oct: 10,
  // French (some Belgian statements are bilingual)
  janvier: 1, fevrier: 2, mars: 3, avril: 4, avr: 4, mai: 5, juin: 6, juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12,
};
const MONTH_RE = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');

const pad = (n) => String(n).padStart(2, '0');
const stripAccents = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

function validDate(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, m - 1, d);
  if (dt.getMonth() !== m - 1) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

function inferYear(m, d, ref) {
  // No year given: take the reference year, unless that puts the date in the future.
  let y = ref.getFullYear();
  const cand = new Date(y, m - 1, d);
  if (cand.getTime() - ref.getTime() > 2 * 86400000) y -= 1;
  return y;
}

/**
 * Find a date inside a string.
 * @returns {{date: string, index: number, length: number}|null}
 */
export function findDate(str, ref = new Date()) {
  const s = stripAccents(String(str).toLowerCase());
  let m;
  // ISO 2026-11-04
  if ((m = /(^|[^\d])(20\d{2})-(\d{1,2})-(\d{1,2})(?!\d)/.exec(s))) {
    const d = validDate(+m[2], +m[3], +m[4]);
    if (d) return { date: d, index: m.index + m[1].length, length: m[0].length - m[1].length };
  }
  // 04/11/2026, 4-11-26, 04.11.2026
  if ((m = /(^|[^\d,.])(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?![\d,])/.exec(s))) {
    let y = +m[4];
    if (y < 100) y += 2000;
    const d = validDate(y, +m[3], +m[2]);
    if (d) return { date: d, index: m.index + m[1].length, length: m[0].length - m[1].length };
  }
  // 4 november 2026 / 4 nov. / di 4 nov
  const re = new RegExp(`(^|[^\\d])(\\d{1,2})(?:e|ste|de)?\\s*(${MONTH_RE})\\.?(?:\\s+(\\d{4}))?(?![a-z])`);
  if ((m = re.exec(s))) {
    const mon = MONTHS[m[3]];
    const day = +m[2];
    const y = m[4] ? +m[4] : inferYear(mon, day, ref);
    const d = validDate(y, mon, day);
    if (d) return { date: d, index: m.index + m[1].length, length: m[0].length - m[1].length };
  }
  // 04/11 (no year) – only when nothing that looks like an amount follows directly
  if ((m = /(^|[^\d,.])(\d{1,2})\/(\d{1,2})(?![\d/,.])/.exec(s))) {
    const day = +m[2], mon = +m[3];
    const d = validDate(inferYear(mon, day, ref), mon, day);
    if (d) return { date: d, index: m.index + m[1].length, length: m[0].length - m[1].length };
  }
  // Relative words used in banking apps
  const rel = /\b(vandaag|today|aujourd'hui|eergisteren|gisteren|yesterday|hier)\b/.exec(s);
  if (rel) {
    const back = rel[1] === 'eergisteren' ? 2 : /gisteren|yesterday|hier/.test(rel[1]) ? 1 : 0;
    const dt = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() - back);
    return { date: todayStr(dt), index: rel.index, length: rel[0].length };
  }
  return null;
}

// Amount with decimal comma (Belgian) or decimal dot; optional sign and currency.
const AMOUNT_RE = /([+\-−–]\s*)?(€\s*|eur\s+)?(\d{1,3}(?:[.\s ']\d{3})+|\d+)([.,])(\d{2})(?![\d.,]*\d)(\s*(?:€|eur\b))?/gi;

/** Parse a single amount string. Returns a signed number or null. */
export function parseAmount(str) {
  const all = findAmounts(String(str));
  return all.length ? all[0].value : null;
}

/** All amounts in a line. value is signed (negative when a minus sign is present). */
export function findAmounts(line) {
  const out = [];
  AMOUNT_RE.lastIndex = 0;
  let m;
  while ((m = AMOUNT_RE.exec(line))) {
    const before = line.slice(Math.max(0, m.index - 1), m.index);
    // skip things glued to letters/digits (IBANs, references) and date fragments like 04.11.2026
    if (/[a-z0-9/]/i.test(before) && !m[1]) continue;
    const intPart = m[3].replace(/[.\s ']/g, '');
    // "1.234" followed by ",56": the dot is a thousands separator; a plain "12.50" is decimal dot.
    const value = parseFloat(`${intPart}.${m[5]}`);
    if (!isFinite(value)) continue;
    const signChar = m[1] ? m[1].trim() : '';
    const sign = signChar === '+' ? 1 : signChar ? -1 : 0;
    out.push({ value: sign === -1 ? -value : value, abs: value, sign, index: m.index, length: m[0].length, hasCurrency: !!(m[2] || m[6]) });
  }
  return out;
}

const BALANCE_WORDS = /\b(saldo|beschikbaar|balance|solde|nieuw saldo|vorig saldo|totaal|total|openstaand|limiet|kredietlimiet|bestedingslimiet|uitgavenlimiet|af te betalen|te betalen|minimum)\b/i;
const INCOME_WORDS = /\b(loon|wedde|salaris|storting|ontvangen|van:|from|creditering|terugbetaling|groeipakket|kinderbijslag|huur ontvangen|huurinkomsten|intrest|rente)\b/i;
const NOISE_LINE = /^(zoeken|search|filter|alle|uitgaven|inkomsten|overzicht|rekeningen|home|menu|meer|betalen|transacties|verrichtingen|historiek|details|terug|annuleren|ok|\d{1,2}:\d{2}.*)$/i;

const HEADER_LINE = /^(?:(?:datum|date|omschrijving|bedrag|description|amount|montant|valuta|valutadatum|mededeling|details|\(eur\)|eur|in eur)\s*)+$/i;
// Sub-lines in banking apps that describe the payment method rather than the merchant
const GENERIC_PAYMENT = /^(?:europese\s+)?(?:betaling|aankoop|domicili[eë]ring|overschrijving|instant overschrijving|debetkaart|bancontact|maestro|contactloos|kaartbetaling|apple pay|google pay|payconiq|geldopname|payment|card payment|direct debit)(?:\s+met\s+(?:debetkaart|bancontact|kaart|apple pay))?$/i;

/** Remove OCR noise from round logos/icons at the start and stray marks at the end of a line. */
function stripOcrJunk(raw) {
  return raw
    .replace(/^\s*[©®@°•·*|>»«_~]+\s*/, '')
    .replace(/^\s*\S{1,3}\s{2,}(?=\S)/, '')
    .replace(/\s{2,}(?:[^\s\d€]{1,2}|[a-z]\))\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanDescription(s) {
  return s
    .replace(/[|•·>›»«‹<_=~*#©®]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,.:;\-–]+|[\s,.:;\-–]+$/g, '')
    .trim();
}

function letters(s) {
  return (s.match(/[a-zà-ÿ]/gi) || []).length;
}

/**
 * Parse free text (OCR / PDF) into transaction candidates.
 * @param {string} text
 * @param {{ref?: Date, accountType?: string}} opts
 * @returns {{items: Array<{date: string|null, description: string, amount: number, sign: number, raw: string}>, balance: number|null}}
 */
export function parseText(text, opts = {}) {
  const ref = opts.ref || new Date();
  const lines = String(text)
    .split(/\r?\n/)
    .map(stripOcrJunk)
    .filter(Boolean);

  const items = [];
  let currentDate = null;
  let pending = []; // description lines waiting for an amount
  let balance = null;
  // 'above': app lists where the merchant name sits on its own line above the amount line
  // 'inline': statements / lists where name and amount share one line
  let layout = null;

  for (const line of lines) {
    if (NOISE_LINE.test(line) || HEADER_LINE.test(line)) continue;
    const amounts = findAmounts(line);
    const dateHit = findDate(line, ref);

    if (!amounts.length) {
      if (dateHit) {
        const rest = cleanDescription(line.slice(0, dateHit.index) + ' ' + line.slice(dateHit.index + dateHit.length));
        // A line that is (almost) only a date, e.g. "Dinsdag 4 november", is a section header
        const restNoDay = rest.replace(/\b(maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag|ma|di|wo|do|vr|za|zo|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b\.?/gi, '').trim();
        if (letters(restNoDay) < 3) {
          currentDate = dateHit.date;
          pending = [];
          continue;
        }
        currentDate = dateHit.date;
        pending.push(restNoDay);
      } else if (letters(line) >= 2) {
        pending.push(cleanDescription(line));
      }
      if (pending.length > 3) pending = pending.slice(-3);
      continue;
    }

    // Balance / limit lines are not transactions, but remember the balance
    if (BALANCE_WORDS.test(line)) {
      if (/saldo|balance|solde/i.test(line) && balance === null) balance = amounts[amounts.length - 1].value;
      pending = [];
      continue;
    }

    // Choose the transaction amount: a signed one first; with two amounts (amount + running balance) the first.
    let pick = amounts.find((a) => a.sign !== 0) || (amounts.length === 2 ? amounts[0] : amounts[amounts.length - 1]);
    if (pick.abs === 0) continue;

    // Description = the line without amounts and date
    let desc = line;
    for (const a of [...amounts].sort((x, y) => y.index - x.index)) desc = desc.slice(0, a.index) + ' ' + desc.slice(a.index + a.length);
    let rowDate = null;
    const d2 = findDate(desc, ref);
    if (d2) {
      rowDate = d2.date;
      desc = desc.slice(0, d2.index) + ' ' + desc.slice(d2.index + d2.length);
    }
    desc = cleanDescription(desc);
    if (!layout) layout = !rowDate && pending.length ? 'above' : 'inline';
    const title = pending.length ? pending[pending.length - 1] : '';
    if (letters(desc) < 3) desc = title || desc || 'Unknown';
    else if (layout === 'above' && title) desc = GENERIC_PAYMENT.test(desc) ? title : `${title} – ${desc}`;
    pending = [];

    let sign = pick.sign;
    if (sign === 0) sign = INCOME_WORDS.test(line + ' ' + desc) && opts.accountType !== 'credit' ? 1 : -1;

    items.push({ date: rowDate || currentDate, description: desc, amount: pick.abs, sign, raw: line });
  }
  return { items, balance };
}

// ---------------------------------------------------------------- CSV ----

export function splitCsvLine(line, delim) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

const H = {
  date: /^(boekingsdatum|datum|uitvoeringsdatum|transactiedatum|date|datum verrichting|valutadatum|date d'execution|date comptable|booking date)$/i,
  amount: /^(bedrag|amount|montant|bedrag \(eur\)|bedrag in eur|transactiebedrag)$/i,
  debit: /^(debet|debit|af|uitgaven)$/i,
  credit: /^(credit|bij|inkomsten)$/i,
  // description columns, in order of preference (counterparty name first)
  desc: [
    /naam.*tegenpartij|tegenpartij.*naam|^tegenpartij$|beneficiary|merchant|handelaar|^nom/i,
    /^(omschrijving|description|details|libell[eé])$/i,
    /mededeling|communication/i,
    /^(transactie|type verrichting|verrichting)$/i,
  ],
};

/**
 * Parse a bank CSV export (Belfius, KBC, Beobank, ...). Columns are detected from the header row.
 * @returns {{items: Array, columns: object}}
 */
export function parseCsv(text, opts = {}) {
  const ref = opts.ref || new Date();
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { items: [], columns: null };
  const delim = [';', ',', '\t'].map((d) => [d, (lines.slice(0, 15).join('\n').match(new RegExp(d === '\t' ? '\t' : d, 'g')) || []).length]).sort((a, b) => b[1] - a[1])[0][0];

  // header = first line (within the first 20) that has a date column and an amount-like column
  let hIdx = -1;
  let cols = null;
  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    const cells = splitCsvLine(lines[i], delim).map((c) => c.replace(/\s+/g, ' ').trim());
    const find = (re) => cells.findIndex((c) => re.test(c));
    const c = { date: find(H.date), amount: find(H.amount), debit: find(H.debit), credit: find(H.credit), desc: [] };
    for (const re of H.desc) cells.forEach((cell, idx) => { if (re.test(cell) && !c.desc.includes(idx)) c.desc.push(idx); });
    // a bare "Naam" column is often the account holder – only use it when nothing better exists
    if (!c.desc.length) cells.forEach((cell, idx) => { if (/^naam$/i.test(cell)) c.desc.push(idx); });
    if (c.date >= 0 && (c.amount >= 0 || c.debit >= 0 || c.credit >= 0)) { hIdx = i; cols = c; break; }
  }
  if (hIdx < 0) {
    // No recognisable header: fall back to free-text parsing
    return { items: parseText(lines.map((l) => splitCsvLine(l, delim).join(' ')).join('\n'), opts).items, columns: null };
  }

  const items = [];
  for (const line of lines.slice(hIdx + 1)) {
    const cells = splitCsvLine(line, delim);
    const dh = findDate(cells[cols.date] || '', ref);
    if (!dh) continue;
    let value = null;
    if (cols.amount >= 0) value = parseLooseNumber(cells[cols.amount]);
    else {
      const debit = parseLooseNumber(cells[cols.debit]);
      const credit = parseLooseNumber(cells[cols.credit]);
      if (debit) value = -Math.abs(debit);
      else if (credit) value = Math.abs(credit);
    }
    if (value === null || value === 0) continue;
    const parts = [];
    for (const i of cols.desc) {
      const v = (cells[i] || '').replace(/\s+/g, ' ').trim();
      if (v && !parts.some((p) => p.includes(v))) parts.push(v);
    }
    const description = parts.join(' – ').slice(0, 160) || 'Unknown';
    items.push({ date: dh.date, description, amount: Math.abs(value), sign: value < 0 ? -1 : 1, raw: line });
  }
  return { items, columns: cols };
}

/** "-1.234,56" / "1234.56" / "1,234.56" / "-45" -> number */
export function parseLooseNumber(s) {
  if (s === undefined || s === null) return null;
  let t = String(s).replace(/[€\s]|eur/gi, '').replace(/−|–/g, '-');
  if (!t) return null;
  const lastComma = t.lastIndexOf(',');
  const lastDot = t.lastIndexOf('.');
  if (lastComma > lastDot) t = t.replace(/\./g, '').replace(',', '.');
  else if (lastDot > lastComma && lastComma >= 0) t = t.replace(/,/g, '');
  else if (lastComma < 0 && (t.match(/\./g) || []).length > 1) t = t.replace(/\./g, '');
  const n = parseFloat(t);
  return isFinite(n) ? n : null;
}
