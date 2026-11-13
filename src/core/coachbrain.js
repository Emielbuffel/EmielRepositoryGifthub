// Tailored coach answers without an API key: works out what the question is about (adding to a position, a first buy,
// selling or holding) and answers it for the stock on screen with your own numbers — shares, average price, the buy point,
// the 50-day line, the market, the next earnings — following O'Neil's rules and your plan. Returns null when the question
// is something else (the general playbook answers take over). Pure function: no network, no storage.

const pct = (x, d = 1) => (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(d) + '%';
const r2 = x => Math.round(x * 100) / 100;
const money = (x, ccy) => Math.round(x).toLocaleString('en-US') + ' ' + ccy;

const ADD = /\b(add|adding|top ?up|increase|full position|whole position|rest of (the|my) position|complete (the|my) position|pyramid|bijkop|bij ?kopen|aanvull|aan ?vullen|volledige positie|hele positie|vergrot|uitbreid|bijleggen)\b|\d+\s?%\s*(of|van)\s*(a|my|the|een|mijn|de)?\s*position/i;
const BUY = /\b(buy|buying|enter|get in|start a position|open a position|kopen|koop|instappen|instap)\b/i;
const SELL = /\b(sell|selling|take profits?|trim|exit|hold|keep|verkop|verkoop|winst nemen|houden|aanhouden|afbouwen)\b/i;

/** The share of a full position the user says they hold ("75% of a position", "half a position", "a third"). */
export function statedFraction(q) {
  const m = /(\d{1,3})\s?%\s*(of|van)/i.exec(q); if (m) return Math.min(1, +m[1] / 100);
  if (/\b(half|helft|halve)\b/i.test(q)) return 0.5;
  if (/\b(third|derde)\b/i.test(q)) return /two|twee/i.test(q) ? 2 / 3 : 1 / 3;
  if (/\b(quarter|kwart)\b/i.test(q)) return /three|drie/i.test(q) ? 0.75 : 0.25;
  return null;
}

/**
 * q: the question; c: ctx.stock.num = {sym, cur, price, pivot, zoneTop, s50, s21, boAgo, failed, held, cost, target (plan ccy),
 * ccy, fx (plan units per listing unit), stopPct, earnDays, earnDate, market ('up'|'press'|'corr'), adds: [{title, level, price}],
 * volRatio (today vs 50-day avg)}
 */
export function tailoredAnswer(q, c) {
  if (!c || !c.price) return null;
  const intent = ADD.test(q) ? 'add' : SELL.test(q) ? 'sell' : BUY.test(q) ? (c.held ? 'add' : 'buy') : null;
  if (!intent) return null;
  return intent === 'add' ? addAnswer(q, c) : intent === 'buy' ? buyAnswer(c) : sellAnswer(c);
}

function common(c) {
  const up = c.pivot ? c.price / c.pivot - 1 : null, ext50 = c.s50 ? c.price / c.s50 - 1 : null, gain = c.cost ? c.price / c.cost - 1 : null;
  return { up, ext50, gain, zone: c.pivot && up >= 0 && c.price <= c.zoneTop, extended: c.pivot && c.price > c.zoneTop };
}

function addAnswer(q, c) {
  const { up, ext50, gain, zone, extended } = common(c), L = [], sym = c.sym;
  const said = statedFraction(q), fx = c.fx || 1;
  // what you say counts first ("75% of a position"); otherwise your holding against the full-position target
  const have = said != null ? said : c.held && c.target ? c.held * c.price * fx / c.target : null;
  const restVal = have != null ? Math.max(0, c.target * (1 - have)) : null, restSh = restVal ? Math.floor(restVal / (c.price * fx)) : null;
  const addPt = (c.adds || []).find(a => a.level === 'add');
  let verdict, why = [];
  if (c.market === 'corr') {
    verdict = 'No — not now: the market is in a correction.'; why.push('O\'Neil makes no new buys and no adds until a follow-through day confirms a new uptrend (Market tab).');
    if (c.pivot) why.push(zone ? `The stock itself is still in its buy zone (${pct(up)} above ${r2(c.pivot)}, zone up to ${r2(c.zoneTop)}): once the market confirms and it is still in the zone, the add is fine.` : extended ? `The stock is also extended (${pct(up)} above the buy point ${r2(c.pivot)}): even in a good market the next add is a pullback to the 50-day line${c.s50 ? ` (${r2(c.s50)})` : ''} or three weeks tight.` : `It is ${pct(up)} under the buy point ${r2(c.pivot)}: no add below it.`);
  }
  else if (gain != null && gain < 0) { verdict = 'No — don\'t add.'; why.push(`You are ${pct(gain)} on your average price ${r2(c.cost)}. O'Neil only adds to positions that show a profit; never average down.`); }
  else if (c.earnDays != null && c.earnDays >= 0 && c.earnDays <= 14) { verdict = 'Wait until after the earnings report.'; why.push(`${sym} reports on ${c.earnDate} (in ${c.earnDays} days). Your rule: no new buys or adds in the ~2 weeks before earnings. Decide on the reaction.`); }
  else if (c.pivot && up < 0) { verdict = 'No — it is below the buy point.'; why.push(`${r2(c.price)} is ${pct(up)} under the buy point ${r2(c.pivot)}. Adds only happen above the buy point while the breakout works.${c.cost ? ` Your sell line stays ${r2(c.cost * (1 - c.stopPct))} (${Math.round(c.stopPct * 100)}% under your average price).` : ''}`); }
  else if (gain != null && gain >= 0.2) { verdict = 'Not here — take profits instead of adding.'; why.push(`You are ${pct(gain)} on your average price. At +20–25% your plan sells the first thirds; a new add only comes at a new base.`); }
  else if (zone) {
    verdict = `Yes — this is still a buy-zone add.`;
    why.push(`${r2(c.price)} is ${pct(up)} above the buy point ${r2(c.pivot)}, inside the buy zone up to ${r2(c.zoneTop)} (+5%).`);
    if (up < 0.01) why.push('Your pyramid adds the second part at +1–2%: you can also wait for that.');
    if (gain != null) why.push(`You are ${pct(gain)} on your average price ${r2(c.cost)}: a winning position, so adding fits the rules.`);
    if (c.volRatio != null && c.volRatio < 1) why.push('Volume today is below average: a quiet day is fine, but the breakout itself should have come on volume ≥ 1.4× average.');
    if (c.boAgo != null && c.boAgo > 15) why.push(`The breakout was ${c.boAgo} sessions ago: the further from it, the smaller the add.`);
  } else if (extended && addPt) {
    verdict = `Yes, but only at the add-on point: ${addPt.title.replace(/^Add-on: /, '')}.`;
    why.push(`The stock is ${pct(up)} above the old buy point (extended), but this is one of O'Neil's follow-on buy points.${addPt.price ? ` Level: ${r2(addPt.price)}.` : ''} Add a smaller amount than your first buy, and sell the add if it closes clearly below that level.`);
  } else if (extended) {
    verdict = 'Not here — it is extended.';
    why.push(`${r2(c.price)} is ${pct(up)} above the buy point ${r2(c.pivot)} — past the buy zone (up to ${r2(c.zoneTop)}). Adding here raises your average price and the risk of a normal pullback shaking you out.`);
    const next = [];
    if (c.s50) next.push(`a quiet pullback to the rising 50-day line (now ${r2(c.s50)}${ext50 != null ? `, ${pct(ext50)} away` : ''}) that holds`);
    next.push('three weeks tight (three weekly closes within ~1.5%) — add above its high');
    next.push('a new base and a new breakout');
    why.push('The next add-on points: ' + next.join('; ') + '. The app alerts you when one appears.');
    if (ext50 != null && ext50 > 0.25) why.push(`It is ${pct(ext50)} above the 50-day line: watch for a climax top rather than adding.`);
  } else { verdict = 'I can\'t judge the add without a buy point.'; why.push('No current base or buy point is found for this stock. Add only at a breakout from a new base, a pullback to the 50-day line that holds, or three weeks tight.'); }

  L.push(`**${verdict}**`, ...why.map(x => '• ' + x));
  if (have != null) {
    L.push('', `Position: ${said != null ? `${Math.round(have * 100)}% as you say` : `${c.held} shares ≈ ${money(c.held * c.price * fx, c.ccy)} = ${Math.round(have * 100)}%`} of a full position (${money(c.target, c.ccy)} = ${Math.round((c.posPct || 0.2) * 100)}% of the account)${have >= 1 ? ' — already full: nothing to add' : ''}.`);
    if (/^Yes/.test(verdict) && restSh > 0) {
      const lim = r2(Math.min(c.price * 1.005, zone ? c.zoneTop : (addPt && addPt.price ? addPt.price * 1.05 : c.price * 1.005)));
      L.push(`To reach 100%: buy about ${restSh} shares (≈ ${money(restVal, c.ccy)}).`);
      if (c.held && c.cost) { const avg = (c.held * c.cost + restSh * c.price) / (c.held + restSh); L.push(`New average ≈ ${r2(avg)} ${c.cur}; your sell line moves to ${r2(avg * (1 - c.stopPct))} (${Math.round(c.stopPct * 100)}% under it) — unless your stop is already higher (raised at +15%/+20%).`); }
      L.push(`DEGIRO: Buy · Limit ${lim} ${c.cur} · ${restSh} shares · day order. When it fills: change your Stop Loss to ${c.held ? c.held + restSh : 'all'} shares.`);
    } else if (restSh > 0) L.push(`The rest to buy later: about ${restSh} shares (≈ ${money(restVal, c.ccy)}).`);
  } else L.push('', `Tip: enter your shares and average price in the Portfolio tab (or tell me "I bought 30 ${sym} at …"), then I can work out exactly how many shares the add is.`);
  L.push('', checksLine(c));
  const tag = /^Yes/.test(verdict) ? `ADD${restSh ? ' about ' + restSh + ' shares' : ''}` : /^Wait/.test(verdict) ? 'WAIT (no add before earnings)' : 'HOLD (no add)';
  L.push(`**${sym} ${tag}**${c.pivot ? ` — buy point ${r2(c.pivot)}, zone to ${r2(c.zoneTop)}` : ''}${c.cost ? `, stop about ${r2(c.cost * (1 - c.stopPct))}` : ''}.`);
  return L.join('\n');
}

function buyAnswer(c) {
  const { up, ext50, zone, extended } = common(c), L = [], fx = c.fx || 1, sh = Math.floor(c.target * 0.5 / (c.price * fx));
  if (c.market === 'corr') L.push('**No — the market is in a correction.**', '• O\'Neil makes no new buys until a follow-through day confirms a new uptrend.');
  else if (c.earnDays != null && c.earnDays >= 0 && c.earnDays <= 14) L.push('**Wait until after the earnings report.**', `• ${c.sym} reports on ${c.earnDate} (in ${c.earnDays} days): no new positions in the ~2 weeks before.`);
  else if (!c.pivot) L.push('**No buy point yet.**', '• No sound base is found right now: wait for a base and buy the breakout.');
  else if (zone) L.push(`**Yes — it is in the buy zone (${pct(up)} above the buy point ${r2(c.pivot)}).**`, `• Your first step is 50% of the position: about ${sh} shares (≈ ${money(c.target * 0.5, c.ccy)}).`, c.volRatio != null ? `• Volume today ${c.volRatio >= 1.4 ? 'confirms it' : 'is light'} (${(c.volRatio).toFixed(1)}× the 50-day average; the breakout should be ≥ 1.4×).` : '', `• DEGIRO: Buy · Limit ${r2(Math.min(c.price * 1.005, c.zoneTop))} · ${sh} shares · day order; then a Stop Loss at ${r2(c.price * (1 - c.stopPct))}.`);
  else if (extended) L.push(`**Not here — extended ${pct(up)} above the buy point ${r2(c.pivot)} (zone ended at ${r2(c.zoneTop)}).**`, `• Wait for a pullback to the 50-day line${c.s50 ? ` (${r2(c.s50)}${ext50 != null ? ', ' + pct(ext50) + ' away' : ''})` : ''} or a new base.`);
  else L.push(`**Not yet — ${pct(up)} under the buy point ${r2(c.pivot)}.**`, `• Buy when it trades above ${r2(c.pivot)} (up to ${r2(c.zoneTop)}) on volume ≥ 1.4× average. DEGIRO: a Stop Limit buy, stop ${r2(c.pivot)}, limit ${r2(c.pivot * 1.02)}, ${sh} shares (50% of the position), until cancelled.`);
  L.push('', checksLine(c));
  const t = /^\*\*Yes/.test(L[0]) ? 'BUY 25–50% starter' : 'WAIT / WATCH';
  L.push(`**${c.sym} ${t}**${c.pivot ? ` — buy point ${r2(c.pivot)}, never above ${r2(c.zoneTop)}` : ''}.`);
  return L.filter(Boolean).join('\n');
}

/** The checks the owner always wants at the end. */
function checksLine(c) {
  return `Checks: your maximum number of stocks, the ${Math.round((c.posPct || 0.2) * 100)}% size per stock, overlap with stocks that move together (same theme), ${c.earnDate ? 'earnings on ' + c.earnDate : 'the next earnings date'}, and the market direction.`;
}

function sellAnswer(c) {
  const { up, ext50, gain } = common(c), L = [];
  if (!c.held || !c.cost) return `I don't see ${c.sym} in your holdings with an average price. Add it in the Portfolio tab (or tell me "I bought … ${c.sym} at …"), then I can say exactly when to sell.`;
  const stop = r2(c.cost * (1 - c.stopPct)), sell = [];
  if (c.price <= stop) sell.push(`it is at or below your stop ${stop} (${Math.round(c.stopPct * 100)}% under your average ${r2(c.cost)}): sell everything, no exceptions`);
  if (c.failed) sell.push('the breakout failed (closed back under the buy point): sell');
  if (c.s50 && c.price < c.s50 && gain > 0.05) sell.push(`it closed under the 50-day line ${r2(c.s50)} — sell if that close came on heavy volume`);
  if (gain >= 0.2) sell.push(`you are ${pct(gain)}: your plan takes a third at +20% and a third at +25%${c.boAgo != null && c.boAgo <= 15 ? ' — unless it gained 20% within 3 weeks of the breakout: then hold at least 8 weeks (the 8-week rule)' : ''}`);
  if (ext50 != null && ext50 > 0.25) sell.push(`it is ${pct(ext50)} above the 50-day line: check for a climax top (biggest gain since the breakout, an exhaustion gap)`);
  const must = c.price <= stop || c.failed, profit = gain >= 0.2;
  if (sell.length) L.push(`**${must ? 'Sell.' : profit ? 'Take profits by your plan.' : 'Hold — but watch closely.'}**`, `• You are ${pct(gain)} on your average price ${r2(c.cost)}${c.held ? ` (${c.held} shares)` : ''}.`, ...sell.map(x => '• ' + x[0].toUpperCase() + x.slice(1) + '.'));
  else L.push(`**Hold.** No sell rule is triggered for ${c.sym}.`, `• You are ${pct(gain)} on your average price ${r2(c.cost)}.`, `• Sell line: ${gain >= 0.15 && c.pivot ? r2(Math.max(stop, c.pivot * 0.97)) + ' (raised to just under the buy point after +15%)' : stop + ` (${Math.round(c.stopPct * 100)}% under your average)`}.`, `• Profit steps: ⅓ at ${r2(c.cost * 1.2)} (+20%), ⅓ at ${r2(c.cost * 1.25)} (+25%); the rest while it holds the 50-day line${c.s50 ? ` (now ${r2(c.s50)})` : ''}.`);
  if (c.earnDays != null && c.earnDays >= 0 && c.earnDays <= 14) L.push(`• Earnings on ${c.earnDate}: with a small cushion (under ~+15%), many O'Neil traders lighten up before the report.`);
  L.push('', `**${c.sym} ${c.price <= stop || c.failed ? 'SELL' : sell.length ? (gain >= 0.2 ? 'TAKE PARTIAL PROFIT' : 'HOLD, watch closely') : 'HOLD'}** — stop ${gain >= 0.15 && c.pivot ? r2(Math.max(stop, c.pivot * 0.97)) : stop}.`);
  return L.join('\n');
}

/* ---------- the whole portfolio: what to sell, trim or keep ---------- */
export const PORTFOLIO_Q = /\b(portfolio|portefeuille|positions|posities|holdings|my stocks|mijn aandelen|trim|trimm|afbouw|afslank|which (ones|stocks|positions)|welke (aandelen|posities)|weed|too many|te veel|rebalanc)\b/i;

/**
 * rv = reviewHoldings(): {items: [{sym, name, verdict, title, score, reasons, m: {gain, m3, w8, rs...}, value, weight, ext50,
 * odd, phase, cur, close, cost}], failed, rank: {list, over, sellNow, suggest}, max, S, z, total, equity}
 */
export function portfolioAnswer(rv) {
  if (!rv || !rv.items.length) return 'I don\'t see any holdings yet. Add them in the Portfolio tab (or tell me "I bought 30 XYZ at 50"), then I can go through them one by one.';
  const S = rv.S, z = rv.z, ccy = S.ccy, it = rv.items, L = [];
  const by = s => it.find(x => x.sym === s), p = x => x == null ? '—' : pct(x, 0);
  const odd = it.filter(x => x.odd);
  // a failed breakout of the latest base on a stock you are well up on = take profits / sell part, not "dump everything"
  const softFail = x => x.m.gain != null && x.m.gain >= 0.1 && x.reasons.filter(r => r[0] === 'bad').every(r => /Failed breakout/.test(r[1]));
  const sell = rv.rank.sellNow.map(by).filter(x => x && !softFail(x));
  const failTrim = rv.rank.sellNow.map(by).filter(x => x && softFail(x));
  const weak = rv.rank.list.filter(x => x.verdict === 'weak' || x.verdict === 'dead');
  const profit = it.filter(x => !x.odd && x.m.gain != null && x.m.gain >= 0.2 && !rv.rank.sellNow.includes(x.sym));
  const climax = it.filter(x => !x.odd && x.ext50 != null && x.ext50 > 0.25 && !rv.rank.sellNow.includes(x.sym));
  const big = it.filter(x => !x.odd && x.weight != null && x.weight > S.posPct * 1.25);
  const leaders = rv.rank.list.filter(x => x.verdict === 'leader');
  const corr = z && z.market === 'corr', press = z && z.market === 'press';
  const allowed = z ? Math.round(z.allowed * 100) : null, invested = z && z.exposure != null ? Math.round(z.exposure * 100) : null;

  // the verdict first
  const act = [...new Set([...sell.map(x => x.sym), ...failTrim.map(x => x.sym), ...weak.map(x => x.sym)])];
  L.push(`**${act.length ? `Yes — sell or trim ${act.length} of your ${it.length} positions${corr ? ' (and raise cash: the market is in a correction)' : ''}.` : profit.length || big.length ? 'Mostly hold — but take some profit / reduce oversized positions.' : 'Hold — no position breaks a sell rule.'}**`);
  if (z) L.push(`Market: ${corr ? 'correction' : press ? 'uptrend under pressure' : 'confirmed uptrend'} → the book allows ~${allowed}% invested, max ${rv.max} position${rv.max === 1 ? '' : 's'} of ${Math.round(S.posPct * 100)}%. You are ${invested != null ? invested + '% invested' : '—'} with ${it.length} positions${it.length > rv.max ? ` — ${it.length - rv.max} more than the limit` : ''}.`);
  if (odd.length) L.push('', `⚠️ First check these tickers — the price is far from your purchase price, probably another company with the same ticker: ${odd.map(x => `${x.sym} (${x.name || '?'}, ${x.close.toFixed(2)} ${x.cur} vs your ${(+x.cost).toFixed(2)})`).join('; ')}. Fix them in Portfolio → Edit (search by name, e.g. UCB → UCB.BR, ENR → ENR.DE). I left them out of the advice below.`);
  if (sell.length) { L.push('', '**Sell — a sell rule is broken:**'); sell.forEach(x => L.push(`• ${x.sym}${x.name ? ' (' + x.name + ')' : ''}: ${(x.reasons.find(r => r[0] === 'bad') || ['', x.title])[1]} ${x.m.gain != null ? `You are ${p(x.m.gain)}.` : ''}`)); }
  if (failTrim.length) { L.push('', '**Trim — the latest breakout failed, but you have a good profit:**'); failTrim.forEach(x => L.push(`• ${x.sym}: ${p(x.m.gain)} on your price. The newest base broke out and failed: sell the shares you added at that breakout and take part of the profit (⅓–½); keep the rest only while it holds the 50-day line${x.s50 ? ` (${x.s50.toFixed(2)})` : ''}.`)); }
  const wk = weak.filter(x => !rv.rank.sellNow.includes(x.sym));
  if (wk.length) { L.push('', `**${corr || it.length > rv.max ? 'Trim first — the weakest' : 'Candidates to trim — lagging'}:**`); wk.forEach(x => L.push(`• ${x.sym}: ${x.verdict === 'dead' ? 'not moving' : 'weak'} (keep score ${x.score}/100) — ${x.m.w8 != null ? p(x.m.w8) + ' in 8 weeks' : ''}${x.m.rs != null ? `, RS ${x.m.rs}` : ''}${x.m.gain != null ? `, ${p(x.m.gain)} on your price` : ''}. Money that could work in a leader.`)); }
  if (profit.length) { L.push('', '**Take partial profits (your plan: ⅓ at +20%, ⅓ at +25%):**'); profit.forEach(x => L.push(`• ${x.sym}: ${p(x.m.gain)} on your price ${(+x.cost).toFixed(2)} → sell about ${Math.round(x.shares / 3)} of ${x.shares} shares${x.m.gain >= 0.25 ? ' (both thirds are due: up to ⅔)' : ''}; keep the rest while it holds the 50-day line${x.s50 ? ` (${x.s50.toFixed(2)})` : ''}.`)); }
  const cl = climax.filter(x => !profit.includes(x));
  if (cl.length) { L.push('', '**Extended — watch for a climax top:**'); cl.forEach(x => L.push(`• ${x.sym}: ${p(x.ext50)} above its 50-day line. Not a sell by itself; sell into a climax run (biggest gain since the breakout, an exhaustion gap).`)); }
  if (big.length) { L.push('', '**Too large a position:**'); big.forEach(x => L.push(`• ${x.sym}: ${Math.round(x.weight * 100)}% of your account vs your ${Math.round(S.posPct * 100)}% size → trim back to ~${Math.round(S.posPct * 100)}% (≈ ${Math.round((x.weight - S.posPct) * rv.equity).toLocaleString('en-US')} ${ccy}).`)); }
  if (leaders.length) L.push('', `**Keep — your leaders:** ${leaders.map(x => `${x.sym} (${p(x.m.gain)}${x.m.rs != null ? ', RS ' + x.m.rs : ''})`).join(', ')}. Let winners run; their stop moves up (breakeven after +20%).`);
  const holds = rv.rank.list.filter(x => x.verdict === 'hold');
  if (holds.length) L.push(`**Hold — acting normally:** ${holds.map(x => x.sym).join(', ')}.`);
  const left = it.length - act.length - odd.length;
  if ((corr || press) && left > rv.max) {
    const next = rv.rank.list.filter(x => !act.includes(x.sym)).sort((a, b) => a.score - b.score).slice(0, left - rv.max);
    L.push('', `${corr ? 'In a correction the book goes to 0–20% invested' : 'Under pressure the book goes to 40–60% invested'}: after the steps above you would still hold ${left} positions for a limit of ${rv.max}. Next to reduce (lowest keep score first): ${next.map(x => `${x.sym} (${x.score})`).join(', ')}. Keep the strongest leaders${leaders.length ? ' (' + leaders.sort((a, b) => b.score - a.score).slice(0, Math.max(1, rv.max)).map(x => x.sym).join(', ') + ')' : ''}.`);
  }
  if (rv.failed.length) L.push('', `No prices for: ${rv.failed.join(', ')} (check the ticker).`);
  L.push('', 'Details per stock: the Sell ideas tab. In DEGIRO: a Limit sell at about the last price (day order); lower your Stop Loss by the shares you sell first.');
  return L.join('\n');
}

/* ---------- which of your stocks the question is about ---------- */
const STOP = new Set(['THE', 'AND', 'FOR', 'BUT', 'NOT', 'ALL', 'ANY', 'CAN', 'NOW', 'WHY', 'HOW', 'BUY', 'SELL', 'HOLD', 'IBD', 'RS', 'EPS', 'DE', 'EN', 'IN', 'IS', 'IT', 'OF', 'OR', 'TO', 'ON', 'AT', 'AN', 'AS', 'BE', 'DO', 'IF', 'MY', 'SO', 'UP', 'WE', 'ME', 'NO', 'OK', 'HET', 'VAN', 'DAT', 'MET', 'OOK', 'NOG', 'WAT']);
/**
 * The holding the question names, by ticker ("msft", "UCB") or by the first word of the company name ("microsoft").
 * holdings: [{sym}], names: {sym: name}. Returns the symbol or null. Two-letter tickers only count when typed in capitals.
 */
export function mentionedHolding(q, holdings = [], names = {}) {
  const words = String(q).split(/[^A-Za-z0-9.&-]+/).filter(Boolean);
  for (const h of holdings) {
    const sym = h.sym || h, base = sym.split('.')[0], B = base.toUpperCase();
    if (words.some(w => w.toUpperCase() === sym.toUpperCase() && (sym.length >= 3 || w === sym))) return sym;
    if (STOP.has(B) && !words.includes(B)) continue;
    if (words.some(w => w.toUpperCase() === B && (B.length >= 3 || w === B))) return sym;
  }
  for (const h of holdings) {
    const sym = h.sym || h, first = String(names[sym] || h.name || '').split(/[\s,.]+/)[0];
    if (first.length >= 4 && new RegExp('\\b' + first.replace(/[^A-Za-z0-9]/g, '') + '\\b', 'i').test(q)) return sym;
  }
  return null;
}

/**
 * The answer for one of your holdings ("why sell MSFT if IBD says hold?"): what the app sees, why it would sell, trim or
 * keep it, and what would change that. x = one item of reviewHoldings(), rv = the whole review.
 */
export function holdingAnswer(q, x, rv) {
  const p = v => v == null ? '—' : pct(v, 1), m = x.m, L = [], S = rv.S, z = rv.z;
  const why = /\b(why|waarom|how come|hoezo)\b/i.test(q), ibd = /\b(ibd|marketsurge|marketsmith|rating|composite)\b/i.test(q);
  const corr = z && z.market === 'corr', press = z && z.market === 'press';
  const hard = x.reasons.filter(r => r[0] === 'bad' && x.verdict === 'sell').map(r => r[1]);
  const soft = x.verdict === 'sell' && m.gain != null && m.gain >= 0.1 && hard.every(t => /Failed breakout/.test(t));
  const over = rv.items.length > rv.max;
  const lower = rv.rank.list.filter(y => y.sym !== x.sym && y.score < x.score).length;
  const chart = `${m.above50 ? 'above' : 'below'} its 50-day line${x.s50 ? ` (${r2(x.s50)})` : ''}${m.above200 != null ? `, ${m.above200 ? 'above' : 'below'} the 200-day` : ''}, ${p(m.w8)} in 8 weeks${m.rs != null ? `, strength rank ${m.rs}` : ''}`;
  let call, tag;
  if (x.verdict === 'sell' && !soft) { call = `**Yes — for ${x.sym} a sell rule is broken, whatever the rating says.**`; tag = 'SELL'; }
  else if (soft) { call = `**${x.sym}: trim, don't dump — the newest breakout failed, but you have a good profit.**`; tag = 'TRIM ⅓–½'; }
  else if (x.verdict === 'weak' || x.verdict === 'dead') { call = `**${x.sym} is not broken — it is lagging. That makes it a trim candidate, not a must-sell.**`; tag = 'HOLD or TRIM (your choice)'; }
  else if ((corr || press) && over) { call = `**You're right: ${x.sym}'s chart itself is fine. The reason was the market, not the stock.**`; tag = lower >= rv.items.length - rv.max ? 'KEEP' : 'HOLD (reduce only if you follow the market limit strictly)'; }
  else { call = `**No — I don't see a reason to sell ${x.sym}.** It is ${x.verdict === 'leader' ? 'one of your leaders' : 'acting normally'}.`; tag = 'HOLD'; }
  L.push(call, '', `**What I see:** ${x.sym}${x.name ? ' (' + x.name + ')' : ''} is ${chart}${m.gain != null ? `; you are ${p(m.gain)} on your average ${r2(+x.cost)}` : ''}. Keep score ${x.score}/100.`);
  L.push('', '**Why:**');
  if (x.verdict === 'sell' && !soft) hard.forEach(t => L.push('• ' + t));
  else if (soft) L.push('• The latest base broke out and fell back under the buy point: the shares you bought at that breakout should go. Your older shares still have a cushion — sell ⅓–½ and keep the rest while it holds the 50-day line.');
  else if (x.verdict === 'weak' || x.verdict === 'dead') x.reasons.filter(r => r[0] !== 'ok').forEach(r => L.push('• ' + r[1]));
  if ((corr || press) && over && x.verdict !== 'sell') L.push(`• The market is ${corr ? 'in a correction' : 'under pressure'}. The book then holds only ${corr ? '0–20%' : '40–60%'} in stocks (your plan: max ${rv.max} position${rv.max === 1 ? '' : 's'}), so it cuts the weakest holdings first — even good ones. ${x.sym} has ${lower} holding${lower === 1 ? '' : 's'} with a lower keep score, so it is ${lower >= rv.items.length - rv.max ? 'not' : 'only later'} on the list.`);
  if (x.verdict === 'leader' || x.verdict === 'hold') x.reasons.filter(r => r[0] === 'ok').slice(0, 3).forEach(r => L.push('• ✓ ' + r[1]));
  if (ibd || why) L.push('', `**About IBD's "hold/buy":** IBD's ratings judge the *company* (earnings, sales, strength). O'Neil's sell rules judge *your position and the market* — the 7–8% stop, a failed breakout, a heavy-volume break of the 50-day line, and how much to own in a correction. Both can be true: a good company you still trim because the market says "less in stocks". ${x.verdict === 'sell' && !soft ? 'A broken sell rule wins.' : 'If the market and your limit don\'t bother you, holding it is consistent with the book as long as it stays above the 50-day line.'}`);
  L.push('', '**What would change it:** ' + (x.verdict === 'sell' && !soft ? `a close back above the buy point / 50-day line on volume — then it can be bought back.` : `sell if it closes under the 50-day line${x.s50 ? ` (${r2(x.s50)})` : ''} on heavy volume or falls ${Math.round((S.stop || 0.07) * 100)}% under your average; ${corr ? 'keep it if the market gets a follow-through day.' : 'add only in a confirmed uptrend from a new base.'}`));
  L.push('', `**${x.sym} ${tag}**${x.s50 ? ` — line in the sand: the 50-day line ${r2(x.s50)}` : ''}.`);
  return L.join('\n');
}

/* ---------- the coach learns from you ---------- */
/** A rule worth remembering in what you wrote ("I don't have NVDA", "always…", "never…", "remember…"), or null. */
export function learnFromText(q) {
  const t = String(q).trim().replace(/\s+/g, ' ');
  let m = /\bi\s+(?:don'?t|do not|no longer|never)\s+(?:have|own|hold)\s+(?:any\s+)?([A-Za-z][A-Za-z0-9.]{0,9})\b/i.exec(t) || /\bik\s+heb\s+(?:geen|nooit)\s+([A-Za-z][A-Za-z0-9.]{0,9})\b/i.exec(t);
  if (m) return `The owner does not own ${m[1].toUpperCase()}. Never assume they hold it; don't bring it up unless they ask about it.`;
  if (/\b(always|never|from now on|remember|stop (doing|saying|starting)|don'?t (start|say|mention|talk)|onthoud|altijd|nooit|vanaf nu)\b/i.test(t) && t.length >= 12 && t.length <= 400) return 'The owner said: "' + t + '"';
  return null;
}
/** Claude marks things worth remembering with <<learn: …>>; take them out of the answer. */
export function takeLearnTags(text) {
  const notes = [];
  const clean = String(text || '').replace(/<<\s*learn\s*:\s*([\s\S]*?)>>/gi, (_, n) => { if (n.trim()) notes.push(n.trim()); return ''; }).replace(/\n{3,}/g, '\n\n').trim();
  return { text: clean, notes };
}
