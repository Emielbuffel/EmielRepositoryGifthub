// Buying plans and the trade journal. A plan follows one position through its pyramid (buy 1, add 2, add 3,
// follow-on buys at the 50-day line) and raises an alert whenever the next step becomes due. Every buy and
// sell goes into the journal ("keep folders of all buys and sells") and updates the holding.
import * as store from './store.js';
import { DEFAULT_PLAN, nextStep } from '../core/strategy.js';
import { sma } from '../core/indicators.js';
import { App, emit } from '../app.js';
import { earnings, isDemo } from './service.js';
import { nextReport } from '../core/earnings.js';
import { factor } from './fx.js';
import { pushEvent, setPlanHook } from './alerts.js';
import { accountValue } from './account.js';
import { sizing } from '../core/sizing.js';

const k = name => name + (isDemo() ? '.demo' : '.real');
const id = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export async function rawStrategy() { return { ...DEFAULT_PLAN, ...(await store.get('strategy', {})) }; }
/**
 * The plan as used everywhere: in 'auto' mode the portfolio value is your own money (stocks at today's prices + cash),
 * so a position is always e.g. 20% of what the account is worth today. S.sz holds the sizing (positions, margin room).
 */
export async function strategy() {
  const S = await rawStrategy();
  S.manualCapital = S.capital;
  if (S.capitalMode !== 'manual') {
    try { const a = await accountValue(S.ccy); if (a.rows.length || a.cashKnown) { S.acct = a; S.auto = true; if (a.equity > 0) S.capital = a.equity; } } catch (e) { /* prices not available: keep the number */ }
  }
  S.sz = sizing(S.acct ? { stocks: S.acct.stocks, cash: S.acct.cash } : { stocks: 0, cash: S.capital }, S, App.mkt || 'up');
  S.maxStocks = S.sz.maxPositions;
  return S;
}
export async function saveStrategy(s) { await store.set('strategy', s); emit('strategy'); }

export async function allPlans() { return store.get(k('plans'), []); }
async function savePlans(list) { await store.set(k('plans'), list); emit('plans'); }
export async function planFor(sym) { return (await allPlans()).find(p => p.sym === sym && !p.closed) || null; }

export async function createPlan({ sym, name = '', pivot, base = '', cur = '' }) {
  const list = await allPlans();
  const open = list.find(p => p.sym === sym && !p.closed);
  if (open) { open.pivot = pivot; open.base = base || open.base; await savePlans(list); return open; }
  const p = { id: id(), sym, name, pivot: +pivot, base, cur, created: Date.now(), buys: [], lastCode: null };
  list.unshift(p); await savePlans(list); return p;
}
export async function updatePlan(pid, patch) { const list = await allPlans(), p = list.find(x => x.id === pid); if (p) { Object.assign(p, patch); await savePlans(list); } return p; }
export async function deletePlan(pid) { await savePlans((await allPlans()).filter(x => x.id !== pid)); }

/* ---------- journal ---------- */
export async function journal() { return store.get(k('journal'), []); }
async function saveJournal(list) { await store.set(k('journal'), list); emit('journal'); }
export const tradesFor = async sym => (await journal()).filter(t => t.sym === sym);

/**
 * Records a trade: {sym, side: 'buy'|'sell', shares, price, t (epoch s), cur, step?, reason?, note?}.
 * Updates the open plan and the holding (average cost on buys; shares on sells).
 */
export async function recordTrade(tr) {
  const t = { id: id(), t: Math.floor(Date.now() / 1000), ...tr, shares: +tr.shares, price: +tr.price };
  const list = await journal(); list.unshift(t); await saveJournal(list);
  const plans = await allPlans(), p = plans.find(x => x.sym === t.sym && !x.closed);
  if (p) {
    if (t.side === 'buy') { p.buys.push({ t: t.t, price: t.price, shares: t.shares, step: t.step }); t.planId = p.id; }
    else { p.sold = (p.sold || 0) + t.shares; const held = p.buys.reduce((s, b) => s + b.shares, 0); if (p.sold >= held) { p.closed = Date.now(); p.closeReason = t.reason || ''; } }
    p.lastCode = null; await savePlans(plans);
  }
  // keep the holdings in step
  const hk = isDemo() ? 'holdings.demo' : 'holdings.real', H = await store.get(hk, []);
  const h = H.find(x => x.sym === t.sym);
  if (t.side === 'buy') {
    if (h) { const sh = h.shares + t.shares; h.cost = h.cost ? (h.cost * h.shares + t.price * t.shares) / sh : t.price; h.shares = sh; }
    else H.push({ sym: t.sym, shares: t.shares, cost: t.price });
  } else if (h) { h.shares = Math.max(0, h.shares - t.shares); if (!h.shares) H.splice(H.indexOf(h), 1); }
  await store.set(hk, H); App.holdings = H; emit('holdings');
  return t;
}
export async function deleteTrade(tid) { await saveJournal((await journal()).filter(x => x.id !== tid)); }

/** Adds journal entries without changing the holdings (e.g. differences found when a broker statement is imported). */
export async function addJournalEntries(list) {
  if (!list.length) return;
  const J = await journal(); J.unshift(...list.map(t => ({ id: id(), ...t }))); await saveJournal(J);
}

/* ---------- cash, margin, deposits and withdrawals ---------- */
// Cash is one balance in one currency (negative = a margin loan). Deposits and withdrawals are kept so the
// performance can leave them out (time-weighted return).
export async function cashBalance() { return store.get(k('cash'), null); }
/** Sets today's cash; `since` remembers when the account was first entered (the start of exact history). */
export async function setCash(amount, cur, at = Math.floor(Date.now() / 1000)) {
  const old = await cashBalance(); await store.set(k('cash'), { amount: +amount, cur, at, since: (old && (old.since || old.at)) || at }); emit('cash');
}
export async function flows() { return store.get(k('flows'), []); }
/** {t, amount (+ deposit, − withdrawal), cur, note?}; changes the cash balance too unless keepCash. */
export async function addFlow(f, { keepCash = false } = {}) {
  const c = await cashBalance(), moved = !keepCash && !!c && c.cur === f.cur;
  const F = await flows(); F.push({ id: id(), ...f, amount: +f.amount, moved }); F.sort((a, b) => a.t - b.t); await store.set(k('flows'), F);
  if (moved) await store.set(k('cash'), { ...c, amount: c.amount + +f.amount });
  emit('cash');
}
/** Removes a deposit/withdrawal; undoes its effect on the cash balance when adding it had changed the balance. */
export async function deleteFlow(fid) {
  const F = await flows(), f = F.find(x => x.id === fid); if (!f) return;
  await store.set(k('flows'), F.filter(x => x !== f));
  const c = await cashBalance(); if (f.moved && c && c.cur === f.cur) await store.set(k('cash'), { ...c, amount: c.amount - f.amount });
  emit('cash');
}

/* ---------- monthly holdings statements and the account statement ---------- */
// snapshots: [{id, t, file, rows: [{sym, name, isin, shares, price, cur, eur}], cash, cashCur}] (holdings on a date)
export async function snapshots() { return store.get(k('snapshots'), []); }
export async function saveSnapshots(list) { await store.set(k('snapshots'), [...list].sort((a, b) => a.t - b.t)); emit('cash'); }
/** Adds or replaces snapshots (one per day). */
export async function addSnapshots(add) {
  const day = t => Math.floor(t / 86400), S = (await snapshots()).filter(s => !add.some(a => day(a.t) === day(s.t)));
  await saveSnapshots([...S, ...add.map(a => ({ id: id(), ...a }))]);
}
// ledger: account-statement lines (see core/ledger.js), kept once each
export async function ledger() { return store.get(k('ledger'), []); }
/** Adds new lines, skipping ones already stored; returns how many were new. */
export async function addLedger(lines) {
  const L = await ledger(), have = new Set(L.map(l => l.id)), add = lines.filter(l => !have.has(l.id));
  await store.set(k('ledger'), [...L, ...add].sort((a, b) => a.t - b.t)); emit('cash'); return add.length;
}
export async function clearLedger() { await store.set(k('ledger'), []); emit('cash'); }

/* ---------- checks ---------- */
/** Works out the next step for the open plan of `sym` from its latest bars; raises an alert when it becomes due. */
export async function checkPlan(sym, bars, name = '') {
  const plans = await allPlans(), p = plans.find(x => x.sym === sym && !x.closed);
  if (!p || !bars || bars.length < 60) return null;
  const S = await strategy(), n = bars.length - 1, c = bars.map(b => b.close), s50 = sma(c, 50);
  let nr = null; try { const e = await earnings(sym); const x = e && nextReport(e); nr = x ? x.time : null; } catch (e) { /* no earnings data */ }
  let fx = 1; try { const f = await factor(p.cur || '', S.ccy); if (f) fx = f.v; } catch (e) { /* plan currency = listing currency */ }
  const first = p.buys.length ? p.buys[0].t : null;
  const peak = first ? Math.max(...bars.filter(x => x.time >= first).map(x => x.close), 0) : 0; // highest close since the first buy
  // the first close at +20% on the average price (for the book's 8-week rule)
  const sh = p.buys.reduce((t, b) => t + b.shares, 0), avg = sh ? p.buys.reduce((t, b) => t + b.price * b.shares, 0) / sh : null;
  const hit = avg && first ? bars.find(x => x.time >= first && x.close >= avg * (1 + (S.profit || [0.2])[0])) : null;
  const st = nextStep(S, p, { close: c[n], s50: s50[n], s50prev: s50[n - 5], nextReport: nr, now: bars[n].time, market: App.mkt && App.mkt.us, fx, peak, t20: hit ? hit.time : null });
  const due = ['buy', 'add', 'stop', 'warn'].includes(st.level);
  if (st.code !== p.lastCode) {
    p.lastCode = st.code; p.lastStep = { ...st, at: Date.now(), close: c[n] }; await store.set(k('plans'), plans);
    if (due) await pushEvent({ sym, name: name || p.name, kind: 'plan', title: `${sym}: ${st.title}`, body: st.text, level: st.level, close: c[n] });
  }
  return st;
}

setPlanHook({ check: checkPlan, syms: async () => (await allPlans()).filter(p => !p.closed).map(p => p.sym) });
