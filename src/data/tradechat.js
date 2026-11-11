// "Tell the coach your trades": turns a chat message into trades the user can check, then saves them like any trade
// (journal + holdings, through recordTrade). Names become tickers from your holdings, the built-in lists and the search;
// a price in another currency is converted to the listing's currency; "half of my LLY" uses the shares you hold.
import { parseTrades, findSymbol, settlePrice } from '../core/tradetalk.js';
import { snapshotMeta, universe, PROVIDERS } from './providers.js';
import { daily, settings } from './service.js';
import { factor } from './fx.js';
import { recordTrade } from './plans.js';
import { isApp } from './net.js';
import { App } from '../app.js';

async function symbolList() {
  const held = (App.holdings || []).map(h => [h.sym, App.names[h.sym] || '']);
  let m = { stocks: [], directory: [] }, u = { items: [] };
  try { m = await snapshotMeta(); } catch (e) { /* none */ }
  try { u = await universe(); } catch (e) { /* none */ }
  return [...held, ...m.stocks.map(s => [s.s, s.n]), ...(m.directory || []).map(d => [d[0], d[1]]), ...u.items.map(i => [i[0], i[1]]), ...Object.entries(App.names || {})];
}

async function resolve(name, list) {
  // stocks you hold come first: "ASML" is your ASML.AS, not the US listing
  const held = (App.holdings || []).map(h => [h.sym, App.names[h.sym] || (list.find(x => x[0] === h.sym && x[1]) || [])[1] || '']);
  const U = name.trim().toUpperCase(), mine = held.find(([s]) => s.split('.')[0] === U) || (held.length && findSymbol(name, held));
  if (mine) return Array.isArray(mine) ? { sym: mine[0], name: mine[1] } : mine;
  const hit = findSymbol(name, list); if (hit) return hit;
  if (isApp()) { try { const r = await PROVIDERS.free.search(name); if (r && r[0]) return { sym: r[0].symbol, name: r[0].name || '' }; } catch (e) { /* offline */ } }
  if (/^[A-Z0-9]{1,6}(\.[A-Z]{1,3})?$/.test(name.trim())) return { sym: name.trim(), name: '' }; // a ticker we don't know yet
  return null;
}

/**
 * Draft trades from a message: [{side, sym, name, qty, price, cur, t, fee, held, problem, note}].
 * Every field can still be changed by the user before saving.
 */
export async function draftTrades(text) {
  const parsed = parseTrades(text); if (!parsed.length) return [];
  const list = await symbolList(), out = [];
  for (const p of parsed) {
    const r = await resolve(p.name, list), d = { side: p.side, sym: r ? r.sym : '', name: r ? r.name : p.name, qty: p.qty, price: null, cur: '', t: p.t, fee: p.fee, held: 0, problem: '', note: '', text: p.text };
    if (!r) d.problem = `I don't know which stock "${p.name}" is. Type its ticker (e.g. ENR.DE, NVDA).`;
    const h = r && (App.holdings || []).find(x => x.sym === r.sym); d.held = h ? h.shares : 0;
    let last = null;
    if (r) { try { const b = await daily(r.sym); last = b.bars[b.bars.length - 1].close; d.cur = b.currency || ''; d.name = d.name || b.name || ''; } catch (e) { /* no prices */ } }
    if (p.frac != null) {
      if (d.held) { d.qty = p.frac === 1 ? d.held : Math.floor(d.held * p.frac); d.note = `${p.frac === 1 ? 'all' : p.frac === 0.5 ? 'half' : Math.round(p.frac * 100) + '%'} of the ${d.held} you hold`; }
      else d.problem = d.problem || `You don't hold ${d.sym || p.name} in the app, so I can't tell how many shares "${p.frac === 1 ? 'all' : 'part'}" is. Type the number.`;
    }
    settlePrice(p, last); d.price = p.price;
    if (p.total != null && p.ambiguous != null) d.note = (d.note ? d.note + '; ' : '') + `${p.ambiguous} read as the total amount`;
    // a price in another currency than the listing's → convert (the cost in the app is in the listing currency)
    if (d.price != null && p.cur && d.cur && p.cur !== d.cur && !(p.cur === 'GBP' && d.cur === 'GBp')) {
      const f = await factor(p.cur, d.cur);
      if (f) { d.note = (d.note ? d.note + '; ' : '') + `${d.price} ${p.cur} = ${(d.price * f.v).toFixed(2)} ${d.cur}${f.live ? '' : ' (reference rate of ' + f.date + ')'}`; d.price = +(d.price * f.v).toFixed(4); }
      else d.problem = d.problem || `I can't convert ${p.cur} to ${d.cur} here: enter the price in ${d.cur}.`;
    } else if (!d.cur) d.cur = p.cur || '';
    if (d.price == null && !d.problem) d.problem = 'No price found: enter the price per share.';
    if (last && d.price && Math.abs(Math.log(d.price / last)) > Math.log(1.6)) d.note = (d.note ? d.note + '; ' : '') + `check the price: the last close is ${last}`;
    if (d.side === 'sell' && d.qty && d.qty > d.held) d.note = (d.note ? d.note + '; ' : '') + `you hold ${d.held} in the app`;
    if (!d.qty && !d.problem) d.problem = 'How many shares?';
    out.push(d);
  }
  return out;
}

/** Saves checked trades. Returns the holdings lines after saving. */
export async function saveTrades(drafts) {
  const done = [];
  for (const d of drafts) {
    await recordTrade({ sym: d.sym, side: d.side, shares: +d.qty, price: +d.price, t: d.t, cur: d.cur, fee: d.fee || undefined, reason: 'told the coach', note: d.text });
    const h = (App.holdings || []).find(x => x.sym === d.sym);
    done.push(`${d.side === 'buy' ? 'Bought' : 'Sold'} ${d.qty} ${d.sym} at ${d.price} ${d.cur} → ${h ? `now ${h.shares} shares, average ${(+h.cost).toFixed(2)} ${d.cur}` : 'position closed'}`);
  }
  return done;
}

/** Messy messages with the user's own Claude key: let Claude rewrite them into simple trade lines the parser reads. */
export async function normaliseWithClaude(text) {
  const key = (settings.keys.anthropic || '').trim(); if (!key) return null;
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
  const r = await client.messages.create({
    model: settings.coachModel || 'claude-opus-5-5', max_tokens: 600,
    tools: [{ name: 'trades', description: 'The stock trades the user reports having done.', input_schema: { type: 'object', properties: { trades: { type: 'array', items: { type: 'object', properties: { side: { type: 'string', enum: ['buy', 'sell'] }, shares: { type: 'number' }, fraction_of_holding: { type: 'number', description: '0.5 for "half", 1 for "all"; only when no number of shares is given' }, stock: { type: 'string', description: 'ticker or company name as the user wrote it' }, price_per_share: { type: 'number' }, total_amount: { type: 'number' }, currency: { type: 'string' }, date: { type: 'string', description: 'YYYY-MM-DD; omit when not said' }, fee: { type: 'number' } }, required: ['side', 'stock'] } } }, required: ['trades'] } }],
    tool_choice: { type: 'tool', name: 'trades' },
    messages: [{ role: 'user', content: `Today is ${new Date().toISOString().slice(0, 10)}. Extract the trades:\n\n${text}` }],
  });
  const b = r.content.find(x => x.type === 'tool_use'); if (!b) return null;
  return b.input.trades.map(x => `${x.side === 'buy' ? 'bought' : 'sold'} ${x.shares ?? (x.fraction_of_holding === 1 ? 'all' : x.fraction_of_holding === 0.5 ? 'half' : x.fraction_of_holding ? 'a third' : '')} ${x.stock}${x.price_per_share ? ' at ' + x.price_per_share + (x.currency ? ' ' + x.currency : '') : x.total_amount ? ' for ' + x.total_amount + (x.currency ? ' ' + x.currency : '') + ' in total' : ''}${x.date ? ' on ' + x.date : ''}${x.fee ? ' fee ' + x.fee : ''}`).join('; ');
}
