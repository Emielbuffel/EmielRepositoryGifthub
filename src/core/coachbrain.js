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
  return L.filter(Boolean).join('\n');
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
  return L.join('\n');
}
