// The O'Neil Coach: answers "what would O'Neil do?" about the stock on screen, the market and the portfolio.
// Two modes:
//  - without an API key: clear, rule-based answers built from the playbook below and the app's own analysis;
//  - with your Anthropic API key (Settings → Coach): full conversations with Claude, which gets the same playbook
//    and the live context. The key stays on this device and is sent only to api.anthropic.com.
import { settings } from './service.js';
import * as store from './store.js';

/* The user's playbook, distilled from the earlier discussions: O'Neil / IBD rules, the webinar notes, the Base
   Pattern Desk back-test and the Buffett moat test. This is the coach's knowledge. */
export const PLAYBOOK = `You are the O'Neil Coach inside Base Pattern Desk, the user's personal stock app.
Answer as a calm, experienced CAN SLIM practitioner. Plain, easy language (English, or Dutch if the user writes Dutch).
Keep answers short and concrete: lead with the call (BUY ZONE / EARLY ENTRY / NEAR BUY POINT / EXTENDED / HOLD / SELL SIGNAL / NO BASE / WAIT),
then the few numbers that matter. Every answer is educational analysis, not investment advice — end with a short reminder when giving a view on a trade.

THE CHECKLIST (in this order)
1. Market (M): new buys only in a confirmed uptrend. Under pressure: fewer and smaller buys. Correction: no new buys.
2. Fundamentals: latest quarterly EPS >= +25% y/y and sales >= +20-25%, ideally accelerating; annual EPS growth >= 25% for 3 years; ROE >= 17%.
   PLUS Buffett's test: a large, durable moat (low-cost producer, powerful brand, switching costs, network effects, patents/licences).
   No moat = at most a short trade with strict rules, never a long-term holding. Classify: great / good / gruesome business.
3. Valuation sanity check: note the P/E vs its own history, but never reject a leader only for a high P/E.
4. Leader (L): RS 80+ (better 90+), RS line at or near a new high — the clearest edge in the back-test.
5. A sound base after a prior uptrend of 30%+, stage 1-2 preferred.
6. Entry: the buy point (the EXACT high of the pivot area — IBD dropped the old +$0.10) or a valid early entry, on volume >= 1.4x the 50-day average.
7. Plan before buying: size, stop price, next earnings date.

BASES: cup with handle (7-65 wk, 12-33% deep, handle >= 1 wk, <= 10-12% deep, upper half, light volume); cup without handle; double bottom
(second low undercuts the first; buy point = middle peak of the W); flat base (5+ wk, <= 15%); ascending base; high tight flag (doubles, flag <= 25%);
three weeks tight (add-on). Faulty bases (too short, V-shaped, low handle, wedging, late stage 3+) hit the -8% stop 52% of the time in the back-test vs 44% for sound ones.

BUY RULES: buy zone = buy point to +5%; beyond that extended — never chase, wait for a pullback to the 50-day line or a new base.
Early entries (downtrend-line break, bounce off the 21/50-day line, shelf, pocket pivot, three weeks tight, shakeout+rally) are allowed only in an uptrend,
for true leaders, in the upper part of a sound base — and START SMALLER: the back-test shows early entries reach +20% before -8% only 16% of the time vs 22% for breakouts.

THE USER'S OWN RULES: each position is 20% of their own money as it is today (stocks at today's prices + cash), so the size grows and shrinks with the account; the number of positions follows from it and the market: 100% invested ÷ 20% = 5 positions, up to 150% (7 positions) with margin — margin up to 50% of their own money, ONLY in a confirmed uptrend, and pays it back when the market comes under pressure; 40–60% invested (3 positions) under pressure, 0–20% in a correction. With margin a 10% fall costs ~15% of his own money: stops matter even more. To add a stock when full, sell the weakest (the Sell ideas tab ranks them). Pyramid 50% at the buy point, 35% at +1-2%, 15% near +5%.
Position target ~20% of the portfolio for top conviction, ~12.5% neutral default. Stop 5-8% below cost, no exceptions. Extra buys at the 50-day line.
NO new positions in the 2 weeks before an earnings report. Trades via DEGIRO; Belgian taxes: TOB per trade and 10% capital-gains tax since 2026 — bundle trades, weigh taxes when selling winners.

SELL RULES: -7-8% stop always. Failed breakout = close ~2%+ back under the buy point soon after. Heavy-volume close under the 50-day line after a run;
close under the 200-day line; RS line at a new low. Take most profits at +20-25% — unless +20% within 3 weeks of breakout: then hold at least 8 weeks. The app's concrete version: sell 1/3 at +20% and 1/3 at +25% on the average price, let the last 1/3 ride while it holds above the 50-day line (sell it on a heavy-volume close below it or a climax top). Raise the stop to just under the buy point at +15% and to breakeven at +20%. Say clearly that the 1/3-1/3-1/3 split is the app's way to apply the book's rule, not a quote from the book.
Climax top: biggest daily gain since breakout, exhaustion gap, or 25%+ above the 50-day line after a fast run.

MARKET RULES: distribution day = index -0.2%+ on higher volume (counts 25 sessions or until +5%). 5+ distribution days or a 50-day break = under pressure.
Follow-through day = day 4+ of a rally attempt, +1.2% on higher volume. Exposure: uptrend 80-100% invested, under pressure 40-60%, correction 0-20%.

ANSWER THE QUESTION ASKED: start with a one-line verdict for exactly what was asked (e.g. "Yes — add the last 25% now" / "Not here — it is extended"), then the reasons with the real numbers from stock.num (price, buy point, buy zone top, 50-day line, the user's shares and average price, the full-position target, earnings date, market), then the concrete action (shares, DEGIRO order type, stop). Never answer with general rules only when the context has the numbers.
HOW TO USE THE APP'S CONTEXT: a JSON context block comes with each question (current stock with pattern phase, signals and fundamentals; market status;
portfolio; the buying-plan settings). Use its numbers instead of inventing any. If data is missing, say so and say where to find it in the app
(e.g. "open the stock in the desktop app for live fundamentals"). Never invent prices, earnings or ratings. If asked about things outside trading, politely steer back.`;

/** One compact context object for the coach (filled by the app; stock may be null). */
export function coachContext({ stock, mkt, holdings, strategy }) {
  const ctx = {};
  if (stock) ctx.stock = stock;
  if (mkt) ctx.market = { us: mkt.us === 'up' ? 'confirmed uptrend' : mkt.us === 'press' ? 'uptrend under pressure' : 'correction', phase: mkt.phase === 'new' ? `new uptrend: follow-through day ${mkt.ftdAgo} sessions ago` : mkt.phase === 'rally' ? `rally attempt day ${mkt.rallyDay}, no follow-through day yet` : undefined, marginAllowed: mkt.us === 'up' };
  if (holdings && holdings.length) ctx.portfolio = { positions: holdings.length, symbols: holdings.map(h => h.sym).slice(0, 12) };
  if (strategy && strategy.sz) { const z = strategy.sz; ctx.account = { ownMoney: Math.round(z.equity), stocks: Math.round(z.stocks), cash: Math.round(z.cash), marginLoan: Math.round(z.loan), marginPctOfOwn: z.marginPct != null ? Math.round(z.marginPct * 100) + '%' : null, invested: z.exposure != null ? Math.round(z.exposure * 100) + '%' : null, allowedNow: Math.round(z.allowed * 100) + '%', maxPositionsNow: z.maxPositions, marginLimit: Math.round(z.maxMargin * 100) + '%', valueFrom: strategy.auto ? 'stocks at today\'s prices + cash' : 'fixed number in settings', warnings: z.notes.map(n => n[1]) }; }
  if (strategy) ctx.plan = { capital: strategy.capital, ccy: strategy.ccy, perPosition: Math.round(strategy.posPct * 100) + '%', pyramid: strategy.tranches.map(t => Math.round(t * 100) + '%').join('/'), stop: Math.round(strategy.stop * 100) + '%', noBuyDaysBeforeEarnings: strategy.earningsDays };
  return ctx;
}

/* ---------- offline answers (no API key): the playbook applied to the context ---------- */
const has = (q, ...words) => words.some(w => q.includes(w));
export function askOffline(q0, ctx) {
  const q = q0.toLowerCase(), s = ctx.stock, m = ctx.market, P = ctx.plan;
  const name = s ? `${s.sym}` : 'this stock';
  const mktLine = m ? `Market: ${m.us}. ${m.us === 'confirmed uptrend' ? 'New buys are allowed (80–100% invested).' : m.us === 'uptrend under pressure' ? 'O’Neil would buy less and smaller (40–60% invested).' : 'O’Neil would make no new buys (0–20% invested).'}` : 'Market state unknown — check the Market tab first; O’Neil always starts there.';
  const out = [];
  if (has(q, 'markt', 'market', 'uptrend', 'correction', 'exposure', 'invested')) {
    out.push(mktLine, 'Rules: 5+ distribution days or a 50-day break = under pressure. A follow-through day (day 4+, +1.2% on higher volume) confirms a new uptrend.');
  } else if (has(q, 'sell', 'verkopen', 'verkoop', 'exit', 'stop')) {
    out.push(`O'Neil's sell rules for ${name}:`,
      '• Always: sell at −7–8% below your cost, no exceptions' + (P ? ` (your setting: −${P.stop}).` : '.'),
      '• Failed breakout: a close ~2%+ back under the buy point soon after the breakout.',
      '• Weakness: a heavy-volume close under the 50-day line after a long run, a close under the 200-day line, or the RS line at a new low.',
      '• Profits: take most at +20–25% — the app sells ⅓ at +20% and ⅓ at +25% on your average price and lets the last ⅓ ride above the 50-day line. Exception: +20% within 3 weeks of the breakout → hold at least 8 weeks.',
      s && s.signals && s.signals.length ? `Right now the app flags: ${s.signals.join('; ')}.` : '');
  } else if (has(q, 'early', 'vroege', 'pocket pivot', 'shakeout', 'trendline', 'downtrend')) {
    out.push('Early entries (before the official breakout): a downtrend-line break in the handle, a bounce off the 21/50-day line, a small shelf, a pocket pivot, three weeks tight, or a shakeout-and-rally.',
      'Only in an uptrend, only for real leaders (RS 80+), only in the upper part of a sound base — and start smaller: in your back-test early entries reached +20% before −8% just 16% of the time, vs 22% for normal breakouts. The official buy point stays the confirmation.');
  } else if (has(q, 'size', 'how much', 'hoeveel', 'position', 'positie', 'pyramid')) {
    out.push(P ? `Your plan: ${P.perPosition} of ${P.capital.toLocaleString('en-US')} ${P.ccy} per position, bought in steps of ${P.pyramid} — 50% at the buy point, 35% at +1–2%, the rest near +5%. Stop −${P.stop}.` : 'Pyramid: 50% at the buy point, 35% at +1–2%, 15% near +5%; stop 5–8% below cost.',
      (ctx.account ? `Positions now: up to ${ctx.account.maxPositionsNow} (${ctx.account.allowedNow} invested allowed in this market${ctx.account.marginLoan ? `; margin loan ${ctx.account.marginLoan.toLocaleString('en-US')} = ${ctx.account.marginPctOfOwn} of your own money, limit ${ctx.account.marginLimit}` : ''}). ` : '') + 'Margin only in a confirmed uptrend, up to your limit; to add a stock when full, sell the weakest (Sell ideas tab). No new positions in the ~2 weeks before earnings' + (s && s.nextEarnings ? ` — ${name} reports ${s.nextEarnings}.` : '.'));
  } else if (has(q, 'moat', 'buffett', 'quality', 'fundament', 'eps', 'earnings', 'winst')) {
    out.push('Fundamentals have two parts in your playbook:',
      '1. O’Neil growth: latest quarterly EPS ≥ +25% y/y, sales ≥ +20–25% (ideally accelerating), 3 years of 25%+ annual EPS growth, ROE ≥ 17%.',
      '2. Buffett’s moat: name it concretely (low-cost producer, brand, switching costs, network, patents), check it is durable 10–20 years, and that it shows in the numbers (ROIC ≥ ~15%, stable margins, FCF ≈ profit). No moat = at most a short trade.',
      s && s.fundamentals ? `${name} now: ${s.fundamentals}.` : `Scroll to the Fundamentals card under the chart for ${name}'s 5-year evolution.`);
  } else if (has(q, 'tax', 'belasting', 'tob', 'degiro')) {
    out.push('Belgian rules from your notes: stock-exchange tax (TOB) on every trade and, since 2026, a 10% capital-gains tax. So bundle trades where you can, and weigh the tax before selling a winner you might otherwise hold.');
  } else if (s) {
    // default: a §9-style read of the current stock
    out.push(`${s.call || s.phase || 'No clear setup'} — ${name}${s.base ? ` · ${s.base}` : ''}.`);
    if (s.pivot) out.push(`Buy point ${s.pivot} (the exact pivot high; IBD dropped the +$0.10). Buy zone to ${s.zoneTop}. ${s.distance != null ? `Price: ${s.distance}.` : ''} Confirmation needs a close above it on volume ≥ 1.4× the 50-day average.`);
    if (s.signals && s.signals.length) out.push('Signals: ' + s.signals.join('; ') + '.');
    if (s.fundamentals) out.push('Fundamentals: ' + s.fundamentals + '.');
    out.push(mktLine);
    if (P) out.push(`If it sets up: ${P.pyramid} pyramid of ${P.perPosition} (${P.capital.toLocaleString('en-US')} ${P.ccy} capital), stop −${P.stop}, nothing new within ${P.noBuyDaysBeforeEarnings} days of earnings.`);
  } else {
    out.push('Open a stock on the Chart tab and ask again — I answer from its pattern, signals, fundamentals and the market state.', mktLine);
  }
  out.push('', 'Educational analysis, not investment advice. (Offline answers — add your Anthropic API key in Settings → Coach for full conversations.)');
  return out.filter(x => x !== undefined).join('\n');
}

/* ---------- online: Claude with the user's own key ---------- */
export const COACH_MODELS = [['claude-opus-5-5', 'Claude Opus 5.5 (best, default)'], ['claude-sonnet-5-5', 'Claude Sonnet 5.5 (cheaper)'], ['claude-haiku-5-5', 'Claude Haiku 5.5 (cheapest)']];

/** history: [{role: 'user'|'assistant', content}] including the newest user turn. Returns the assistant's text. */
export async function askClaude(history, ctx) {
  const key = (settings.keys.anthropic || '').trim();
  if (!key) throw new Error('No API key. Add your Anthropic API key in Settings → Coach.');
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
  const model = settings.coachModel || 'claude-opus-5-5';
  try {
    const r = await client.beta.messages.create({
      model, max_tokens: 2048,
      betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default', // a safety decline falls back instead of failing
      system: [{ type: 'text', text: PLAYBOOK, cache_control: { type: 'ephemeral' } }],
      messages: [
        { role: 'user', content: 'Context from the app right now (JSON):\n' + JSON.stringify(ctx) },
        { role: 'assistant', content: 'Understood. I will use only these numbers and the playbook.' },
        ...history,
      ],
    });
    if (r.stop_reason === 'refusal') return 'I can’t answer that one. ' + ((r.stop_details && r.stop_details.explanation) || '');
    return r.content.filter(b => b.type === 'text').map(b => b.text).join('\n') || '(empty answer)';
  } catch (e) {
    const { default: A } = await import('@anthropic-ai/sdk');
    if (e instanceof A.AuthenticationError) throw new Error('The API key was refused. Check it in Settings → Coach (it starts with sk-ant-).');
    if (e instanceof A.RateLimitError) throw new Error('Rate limit reached at Anthropic. Wait a minute and try again.');
    if (e instanceof A.APIError) throw new Error('Anthropic error ' + e.status + ': ' + e.message);
    throw new Error('Could not reach api.anthropic.com. ' + (e.message || e));
  }
}

/* ---------- the owner's private coach training ----------
   Rules, style and example answers taken from the owner's own earlier chats. The text is personal (it mentions the
   portfolio), so it is never part of the code or the repository: it lives on the device (store key 'coachTraining')
   and travels only with the owner's private sync (private Gist / private storage on claude.ai). */
export const TRAINING_KEY = 'coachTraining';
export async function getTraining() { const t = await store.get(TRAINING_KEY, ''); return typeof t === 'string' ? t : ''; }
export async function setTraining(text) { await store.set(TRAINING_KEY, String(text || '').slice(0, 120000)); }
/* What the coach learned in your chats: rules you stated or corrections (👎), and answers you liked (👍). Private too:
   on the device and in the private sync only. */
export const LEARN_KEY = 'coachLearned';
export async function getLearned() { const l = await store.get(LEARN_KEY, []); return Array.isArray(l) ? l : []; }
export async function addLearned(kind, text, q = '') {
  text = String(text || '').trim(); if (!text) return false;
  const l = await getLearned();
  if (l.some(x => x.kind === kind && x.text === text)) return false;
  l.push({ t: Date.now(), kind, text: text.slice(0, kind === 'example' ? 2500 : 600), q: String(q).slice(0, 400) });
  const rules = l.filter(x => x.kind !== 'example').slice(-80), ex = l.filter(x => x.kind === 'example').slice(-20);
  await store.set(LEARN_KEY, [...rules, ...ex].sort((a, b) => a.t - b.t));
  return true;
}
export async function clearLearned() { await store.set(LEARN_KEY, []); }
async function privateTraining() {
  const t = (await getTraining()).trim(), l = await getLearned();
  let out = '';
  if (t) out += '\n\nTHE OWNER\'S PRIVATE COACHING NOTES (from the owner\'s own earlier chats). Follow their rules, structure and tone; where they are more specific than the playbook above, they win. The examples show how to answer — never copy their numbers into a new answer; use the context JSON and the chart for this stock:\n' + t;
  const rules = l.filter(x => x.kind !== 'example'), ex = l.filter(x => x.kind === 'example');
  if (rules.length) out += '\n\nWHAT YOU LEARNED FROM THE OWNER IN EARLIER CHATS (newest last; these override older habits):\n' + rules.map(x => '- ' + x.text).join('\n');
  if (ex.length) out += '\n\nANSWERS THE OWNER MARKED AS GOOD (copy the style, not the numbers):\n' + ex.slice(-8).map(x => 'Q: ' + x.q + '\nA: ' + x.text).join('\n---\n');
  return out;
}

/* ---------- the coach as a conversation partner that also sees the chart ---------- */
// How to talk: like a personal coach in a chat, not a fixed template. Used by both ways of reaching Claude below.
export const COACH_STYLE = `HOW TO TALK: you are the user's personal trading coach in a chat. Answer exactly what was asked, in the user's language, like a conversation —
not a fixed template. A picture of the chart the user is looking at comes with the question (daily candles, moving averages, volume pane,
pattern lines and the buy point the app found): look at it and refer to what you see ("the handle formed on lighter volume", "it closed back
under the pivot"). When the question is about the chart or a trade, write the read the way the playbook says: lead with the call, then the base
(type, weeks, depth, buy point, faults), the price versus the buy point and the 50/200-day lines, volume and the RS line, what would make it a buy
(close above X on volume ≥ Y) and where the stop is, fundamentals in one line and the market. Use the exact numbers from the context JSON (stock.num:
price, pivot, zoneTop, s50, the user's shares and average cost, target size, earnings date, market). If the picture and the numbers disagree,
say so and trust the numbers. If something you said earlier was wrong, correct it openly. Follow-up questions build on the earlier answers.
Keep it focused (usually 5–12 lines), give the concrete action (shares, DEGIRO order type, stop) when it is about buying, adding or selling,
and end with "Not investment advice."
WHICH STOCK: answer about the stock the user names. If they name one of their holdings (context: focus / portfolio.review), answer about
that one, even if another stock is on the screen. The stock on screen (context: stock, and the chart picture) is only the subject when the
user doesn't name another one. Never assume the user owns a stock that is not in their holdings, and don't bring up the stock on screen
when the question is about something else. When the user asks "why" about something you said earlier, explain THAT answer and admit it
if it was too strict or wrong.
LEARNING: when the user corrects you, tells you a fact about themselves ("I don't own X", "my positions are 15%") or a preference ("always
show…", "don't start with…"), put ONE line at the very end: <<learn: the rule in one short sentence>>. The app saves it privately and
gives it back to you next time. Only for lasting rules, not for one-off questions.`;

const blobB64 = b => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = no; r.readAsDataURL(b); });

let sampleP = null;
/** Claude through the claude.ai page itself (the viewer's own Claude account, no API key): the `sample` capability, or null. */
export function pageClaude() {
  if (!sampleP) {
    const c = typeof window !== 'undefined' && window.claude;
    sampleP = c && typeof c.use === 'function' ? c.use('sample').catch(() => null) : Promise.resolve(null);
  }
  return sampleP;
}

/** Which way the coach can reach Claude here: 'page' (claude.ai), 'key' (your API key) or null (offline answers). */
export async function aiMode() {
  if ((settings.keys.anthropic || '').trim()) return 'key';
  return (await pageClaude()) ? 'page' : null;
}

/**
 * One coach turn with Claude. history: [{role, content}] ending with the user's question; images: Blob[] (the chart,
 * pictures the user added) sent with the newest question only. onText(text) streams the answer on claude.ai.
 */
export async function askCoachAI(history, ctx, images = [], onText) {
  const mode = await aiMode(); if (!mode) throw new Error('No Claude connection here.');
  const training = await privateTraining();
  const intro = PLAYBOOK + '\n\n' + COACH_STYLE + training + '\n\nContext from the app right now (JSON):\n' + JSON.stringify(ctx);
  if (mode === 'page') {
    const sample = await pageClaude();
    let imgs = [];
    try { const lim = sample.limits ? await sample.limits() : null; if (lim && lim.images) imgs = images.slice(0, 4); } catch (e) { /* text only */ }
    const msgs = [{ role: 'user', content: intro + '\n\n(Reply "OK" to this setup message.)' }, { role: 'assistant', content: 'OK.' }, ...history];
    try {
      const r = await sample(msgs, { modelTier: 'complex', cache: false, ...(imgs.length ? { images: imgs } : {}), ...(onText ? { onText: ({ text }) => onText(text) } : {}) });
      return r.text + (images.length && !imgs.length ? '\n\n(I could not look at the chart picture here; this answer uses the numbers only.)' : '');
    } catch (e) {
      if (e && e.code === 'not_granted') throw new Error('The page may not ask Claude: allow it in the page\'s permissions, or add your API key in Settings → Coach.');
      if (e && e.code === 'rate_limited') throw new Error('Claude is busy (rate limit). Try again in a minute.');
      throw new Error((e && e.message) || 'Claude did not answer.');
    }
  }
  // your own API key: Claude with vision
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: settings.keys.anthropic.trim(), dangerouslyAllowBrowser: true });
  const last = history[history.length - 1], pics = await Promise.all(images.slice(0, 4).map(async b => ({ type: 'image', source: { type: 'base64', media_type: b.type || 'image/png', data: await blobB64(b) } })));
  const msgs = [...history.slice(0, -1), { role: 'user', content: [...pics, { type: 'text', text: last.content }] }];
  try {
    const r = await client.beta.messages.create({
      model: settings.coachModel || 'claude-opus-5-5', max_tokens: 2048,
      betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
      system: [{ type: 'text', text: PLAYBOOK + '\n\n' + COACH_STYLE + training, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: 'Context from the app right now (JSON):\n' + JSON.stringify(ctx) }, { role: 'assistant', content: 'Understood. I will use these numbers, the chart and the playbook.' }, ...msgs],
    });
    if (r.stop_reason === 'refusal') return 'I can’t answer that one. ' + ((r.stop_details && r.stop_details.explanation) || '');
    return r.content.filter(b => b.type === 'text').map(b => b.text).join('\n') || '(empty answer)';
  } catch (e) {
    const { default: A } = await import('@anthropic-ai/sdk');
    if (e instanceof A.AuthenticationError) throw new Error('The API key was refused. Check it in Settings → Coach (it starts with sk-ant-).');
    if (e instanceof A.RateLimitError) throw new Error('Rate limit reached at Anthropic. Wait a minute and try again.');
    if (e instanceof A.APIError) throw new Error('Anthropic error ' + e.status + ': ' + e.message);
    throw new Error('Could not reach api.anthropic.com. ' + (e.message || e));
  }
}
