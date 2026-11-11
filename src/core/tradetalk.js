// Trades told in plain words, in English or Dutch, turned into trade records:
//   "bought 50 NVDA at 182.30 yesterday"        → buy 50 NVDA, 182.30 per share, yesterday
//   "kocht 120 Siemens Energy aan €98,40"        → buy 120 Siemens Energy, 98.40 EUR per share, today
//   "sold 20 ASML for 12.800 euro in total"      → sell 20 ASML, 640 EUR per share
//   "I added 30 shares of Meta @ 641 on 3 Nov and sold half of my LLY at 1432" → two trades ("half" stays a fraction)
// Pure functions: no network, no storage (the app resolves names to tickers and asks before saving anything).

const BUY = /\b(bought|buy|buying|bot|purchased|added|add|picked up|opened|kocht|gekocht|koop|aangekocht|bijgekocht|ingestapt)\b/i;
const SELL = /\b(sold|sell|selling|trimmed|trim|closed|dumped|took profits?|verkocht|verkoop|verkopen|afgebouwd|uitgestapt)\b/i;
const MONTHS = { jan: 0, feb: 1, mar: 2, maa: 2, mrt: 2, apr: 3, may: 4, mei: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, okt: 9, nov: 10, dec: 11 };
const CUR = { '€': 'EUR', eur: 'EUR', euro: 'EUR', euros: 'EUR', '$': 'USD', usd: 'USD', dollar: 'USD', dollars: 'USD', '£': 'GBP', gbp: 'GBP', pound: 'GBP', pounds: 'GBP', gbx: 'GBp', pence: 'GBp', p: 'GBp', chf: 'CHF', sek: 'SEK', dkk: 'DKK', nok: 'NOK', jpy: 'JPY', '¥': 'JPY', yen: 'JPY', hkd: 'HKD', krw: 'KRW', cad: 'CAD' };
const NUM = String.raw`\d[\d.,']*\d|\d`;

/** "1.432,29" → 1432.29, "1,432.29" → 1432.29, "98,40" → 98.4, "12.800" → 12800, "182.30" → 182.3 */
export function parseNum(s) {
  s = String(s).replace(/['\s]/g, '');
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) return +s.replace(/\./g, '').replace(',', '.');
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) return +s.replace(/,/g, '');
  if (/,/.test(s) && !/\./.test(s)) return +s.replace(',', '.');
  return +s.replace(/,/g, '');
}

/** A date written in the clause (epoch seconds, noon UTC), or null. `today` = epoch ms. */
export function parseDate(c, today = Date.now()) {
  const d0 = new Date(today), day = (y, m, d) => Date.UTC(y, m, d, 12) / 1000;
  const T = day(d0.getUTCFullYear(), d0.getUTCMonth(), d0.getUTCDate());
  if (/\b(today|vandaag|this morning|vanmorgen|vanochtend)\b/i.test(c)) return T;
  if (/\b(yesterday|gisteren)\b/i.test(c)) return T - 86400;
  if (/\b(eergisteren|day before yesterday)\b/i.test(c)) return T - 2 * 86400;
  let m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(c); if (m) return day(+m[1], +m[2] - 1, +m[3]);
  const year = (mo, d) => { const y = d0.getUTCFullYear(); return day(y, mo, d) > T + 86400 ? y - 1 : y; }; // "3 Nov" in the future → last year
  m = /\b(?:on|op)\s+(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/i.exec(c);
  if (m) { const y = m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : year(+m[2] - 1, +m[1]); return day(y, +m[2] - 1, +m[1]); }
  m = /\b(\d{1,2})(?:st|nd|rd|th|e)?\s+(jan|feb|mar|maa|mrt|apr|may|mei|jun|jul|aug|sep|oct|okt|nov|dec)[a-z]*\.?(?:\s+(\d{4}))?\b/i.exec(c);
  if (m) { const mo = MONTHS[m[2].toLowerCase()]; return day(m[3] ? +m[3] : year(mo, +m[1]), mo, +m[1]); }
  m = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/i.exec(c);
  if (m) { const mo = MONTHS[m[1].toLowerCase()]; return day(m[3] ? +m[3] : year(mo, +m[2]), mo, +m[2]); }
  return null;
}

const STOP = /\s(?:(?:at|for|aan|voor|tegen|à|a|op|on|yesterday|today|gisteren|vandaag|this|last|with|met|and|en|in|from|van|of|kosten|fee|costs?|commission|eergisteren|per)(?=\s|$)|@|[€$£¥]|\d)/i;
const cleanName = s => s.replace(/^(of|van|in|my|mijn|the|de|het|more|extra|meer|shares? of|aandelen)\s+/gi, '').replace(/^(of|van|in|my|mijn|the|de|het)\s+/gi, '').replace(/\b(shares?|aandelen|stocks?|stuks?|stuk)\b/gi, '').replace(/[.,;:!?]+$/, '').replace(/\s+/g, ' ').trim();

/** One clause → a trade, or null. `side` is inherited from the previous clause when the clause has none. */
function clause(c, prevSide, today) {
  const side = SELL.test(c) && !(BUY.test(c) && BUY.exec(c).index < SELL.exec(c).index) ? 'sell' : BUY.test(c) ? 'buy' : prevSide;
  if (!side) return null;
  const verb = (side === 'buy' ? BUY : SELL).exec(c), rest = verb ? c.slice(verb.index + verb[0].length) : c;
  // quantity: a number, "half", "all", "a third"
  let qty = null, frac = null, what = '', m;
  const before = verb ? c.slice(0, verb.index).replace(/\b(gisteren|vandaag|eergisteren|yesterday|today|ik|i|heb|have|ook|also|nog)\b/gi, ' ') : '';
  const qm = new RegExp(String.raw`^\s*(?:another\s+|nog\s+|extra\s+)?(${NUM})\s*(?:x\s+|shares?\s+(?:of\s+)?|aandelen\s+|stuks?\s+|st\.?\s+)?(.*)$`, 'i').exec(rest);
  const qb = new RegExp(String.raw`(?:^|\s)(${NUM})\s*(?:x\s+|shares?\s+(?:of\s+)?|aandelen\s+|stuks?\s+)?([A-Za-z][^\d@€$]*?)\s*$`, 'i').exec(before);
  if (qm && /[A-Za-z]/.test(qm[2])) { qty = parseNum(qm[1]); what = qm[2]; }
  else if (qb) { qty = parseNum(qb[1]); what = qb[2]; }
  else if ((m = /^\s*(?:the\s+other\s+|de\s+andere\s+)?(half|de helft|helft|a third|one third|een derde|a quarter|een kwart|all|everything|alles|alle|the rest|de rest)\s*(?:of\s+|van\s+)?(?:my\s+|mijn\s+)?(?:shares?\s+(?:of\s+|in\s+)?|aandelen\s+)?(.*)$/i.exec(rest))) {
    frac = /half|helft/i.test(m[1]) ? 0.5 : /third|derde/i.test(m[1]) ? 1 / 3 : /quarter|kwart/i.test(m[1]) ? 0.25 : 1; what = m[2];
  } else if ((m = /^\s*(?:shares?\s+(?:of\s+)?|aandelen\s+)?(.+?)\s*[:,]?\s*(${NUM})\s*(?:shares?|aandelen|stuks?)\b(.*)$/i.exec(rest))) { what = m[1]; qty = parseNum(m[2]); }
  else return null;
  // the name runs up to the price / date words
  const stop = STOP.exec(' ' + what); let name = cleanName(stop ? what.slice(0, stop.index) : what);
  if (!name) return null;
  // price: "at 182.30", "@ €98,40", "for 12.800 euro in total", "aan 98,40 EUR per stuk", "voor 5000 euro totaal"
  let price = null, total = null, cur = null;
  const pm = new RegExp(String.raw`(?:\bat\b|@|\bfor\b|\baan\b|\bvoor\b|\btegen\b|à|\bprice\b|\bprijs\b)\s*(€|\$|£|¥)?\s*(${NUM})\s*(€|\$|£|euros?|eur|usd|dollars?|gbp|pounds?|gbx|pence|p\b|chf|sek|dkk|nok|jpy|yen|hkd|krw|cad)?\s*(each|per share|a share|apiece|per stuk|per aandeel|stuk|in total|total|totaal|in totaal|samen)?`, 'i').exec(c);
  const pm2 = !pm && new RegExp(String.raw`(€|\$|£|¥)?\s*(${NUM})\s*(€|\$|£|euros?|eur|usd|dollars?|gbp|gbx|pence|chf|sek|dkk|nok|jpy|hkd|krw|cad)?\s*(each|per share|a share|apiece|per stuk|per aandeel|per share)\b`, 'i').exec(rest);
  if (pm2) { price = parseNum(pm2[2]); cur = CUR[(pm2[1] || pm2[3] || '').toLowerCase()] || null; }
  if (pm) {
    const v = parseNum(pm[2]); cur = CUR[(pm[1] || pm[3] || '').toLowerCase()] || null;
    const kind = (pm[4] || '').toLowerCase();
    if (/total|totaal|samen/.test(kind)) total = v; else price = v;
    if (!kind && /\b(for|voor)\b/i.test(pm[0]) && qty && v > 0) { price = null; total = null; var ambiguous = v; } // "for 5000": per share or in total? decided with the price
  }
  const fm = new RegExp(String.raw`(?:fee|fees|costs?|commission|kosten|transactiekosten)\s*(?:of|van)?\s*(€|\$|£)?\s*(${NUM})`, 'i').exec(c);
  return {
    side, qty, frac, name, price, total, ambiguous: typeof ambiguous === 'number' ? ambiguous : null, cur,
    fee: fm ? parseNum(fm[2]) : null, t: parseDate(c, today), text: c.trim(),
  };
}

/** All trades in a message (English or Dutch). Returns [] when the message is not about trades. */
export function parseTrades(text, today = Date.now()) {
  const parts = String(text || '').replace(/\s+/g, ' ')
    .split(/\s*(?:[;\n]|\.\s+(?=[A-Z])|,?\s+(?:and then|then|and also|and|daarna|dan|en ook|en|also|ook|plus)\s+(?=(?:i\s+|ik\s+|also\s+|ook\s+)?(?:bought|buy|bot|purchased|added|add|sold|sell|trimmed|closed|kocht|gekocht|koop|bijgekocht|aangekocht|verkocht|verkoop|another|nog|\d)))\s*/i);
  const out = []; let prev = null, lastDate = null;
  for (const p of parts) {
    if (!p) continue;
    const tr = clause(p, prev, today); if (!tr) continue;
    if (tr.t == null) { if (!(BUY.test(p) || SELL.test(p))) tr.t = lastDate; } else lastDate = tr.t; // "…yesterday, and 40 KBC" shares the date
    prev = tr.side; out.push(tr);
  }
  const T = Math.floor(Date.UTC(new Date(today).getUTCFullYear(), new Date(today).getUTCMonth(), new Date(today).getUTCDate(), 12) / 1000);
  for (const tr of out) if (tr.t == null) tr.t = T;
  return out;
}

/** Does a message look like someone reporting trades (rather than asking a question)? */
export const looksLikeTrades = t => (BUY.test(t) || SELL.test(t)) && new RegExp(NUM + '|half|helft|all\\b|alles').test(t) && !/^\s*(should|would|can|could|is|are|do|does|what|when|why|how|moet|zou|kan|wat|wanneer|waarom|hoe)\b/i.test(t);

/**
 * Finds the ticker for a name or ticker typed by the user in a list of [sym, name] pairs (held stocks first).
 * Returns {sym, name} or null.
 */
export function findSymbol(q, list) {
  const Q = q.trim(), U = Q.toUpperCase(), fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const f = fold(Q); if (!f) return null;
  let hit = list.find(([s]) => s === U) || list.find(([s]) => s.split('.')[0] === U && /^[A-Z0-9-]{1,6}$/.test(U));
  if (hit) return { sym: hit[0], name: hit[1] };
  const legal = / (inc|corp|corporation|ltd|plc|sa|nv|ag|se|co|group|holding|holdings|class a|class b|the)\b/g;
  const named = list.map(([s, n]) => [s, n, fold(n).replace(legal, '').trim()]);
  hit = named.find(x => x[2] === f) || named.find(x => x[2].startsWith(f + ' ')) || (f.length >= 4 && named.find(x => x[2].startsWith(f)))
    || (f.length >= 5 && named.find(x => (' ' + x[2] + ' ').includes(' ' + f + ' ')));
  return hit ? { sym: hit[0], name: hit[1] } : null;
}

/**
 * Fills in the per-share price: "for 5000" counts as the total when 5000 per share would be far from the stock's price
 * (and 5000 / shares is close to it). `last` = the stock's latest price (or null).
 */
export function settlePrice(tr, last) {
  if (tr.price == null && tr.total != null && tr.qty) tr.price = tr.total / tr.qty;
  if (tr.price == null && tr.ambiguous != null && tr.qty) {
    const each = tr.ambiguous, per = tr.ambiguous / tr.qty;
    tr.price = last > 0 && Math.abs(Math.log(per / last)) < Math.abs(Math.log(each / last)) ? per : each;
    if (tr.price === per) tr.total = tr.ambiguous;
  }
  return tr;
}
