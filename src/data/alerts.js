// Price alerts: buy-point breakouts, stops and price levels, checked on the device whenever prices load
// (opening a stock, a scan, the portfolio) and with "Check now". In the iPhone/Mac app a triggered alert also
// sends a notification. iOS doesn't let an app check prices on a timer in the background, so alerts are
// checked when the app is opened or refreshed. The desktop app also checks every 30 minutes while it is open.
import { Capacitor } from '@capacitor/core';
import { isDesktop } from './net.js';
import { LocalNotifications } from '@capacitor/local-notifications';
import * as store from './store.js';
import { daily } from './service.js';

export const ALERT_TYPES = {
  breakout: { label: 'Breaks out above', dir: 'up' },
  above: { label: 'Closes above', dir: 'up' },
  below: { label: 'Closes below', dir: 'down' },
  stop: { label: 'Stop: closes below', dir: 'down' },
  plan: { label: 'Buying plan', dir: null }, // events raised by buying plans (see plans.js)
  signal: { label: 'Buy zone / add-on', dir: null }, // buy-zone and add-on points on stocks you own (see live.js)
};

// Buying plans register here (plans.js imports this module, so it can't be imported back).
let planHook = null;
export const setPlanHook = h => { planHook = h; };

/** Adds an already-triggered event (e.g. "Add 2 now" from a buying plan) and notifies. */
export async function pushEvent({ sym, name = '', kind = 'plan', title, body, level, close }) {
  await allAlerts();
  const x = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), created: Date.now(), triggered: Date.now(), seen: false, sym, name, type: kind, title, body, level, close, level2: level };
  list.unshift(x); list = list.slice(0, 300); await save();
  notifyRaw(title, body);
  return x;
}

let list = null; const subs = new Set();
export const onAlerts = fn => { subs.add(fn); return () => subs.delete(fn); };
const changed = () => subs.forEach(fn => { try { fn(list); } catch (e) { /* ignore */ } });

export async function allAlerts() { if (!list) list = await store.get('alerts', []); return list; }
async function save() { await store.set('alerts', list); changed(); }

export async function addAlert(a) {
  await allAlerts();
  const x = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), created: Date.now(), triggered: null, ...a, level: +(+a.level).toFixed(4) };
  list = list.filter(y => !(y.sym === x.sym && y.type === x.type && !y.triggered)); // one active alert per stock and type
  list.unshift(x); await save(); askPermission(); return x;
}
export async function removeAlert(id) { await allAlerts(); list = list.filter(x => x.id !== id); await save(); }
export async function rearm(id) { await allAlerts(); const x = list.find(y => y.id === id); if (x) { x.triggered = null; x.close = null; await save(); } }
export const activeFor = async sym => (await allAlerts()).filter(x => x.sym === sym && !x.triggered);
export const triggeredCount = async () => (await allAlerts()).filter(x => x.triggered && !x.seen).length;
export async function markSeen() { await allAlerts(); list.forEach(x => { if (x.triggered) x.seen = true; }); await save(); }

let asked = false;
async function askPermission() {
  if (asked || !Capacitor.isNativePlatform()) return; asked = true;
  try { const p = await LocalNotifications.checkPermissions(); if (p.display !== 'granted') await LocalNotifications.requestPermissions(); } catch (e) { /* not available */ }
}

/** Checks one stock's latest bars against its alerts. Returns the alerts that triggered now. */
export async function checkBars(sym, bars, name = '') {
  if (planHook) { try { await planHook.check(sym, bars, name); } catch (e) { /* plan check failed */ } }
  const act = (await allAlerts()).filter(x => x.sym === sym && !x.triggered);
  if (!act.length || !bars || bars.length < 2) return [];
  const last = bars[bars.length - 1], hits = [];
  for (const a of act) {
    if (last.time * 1000 < a.created - 86400e3) continue; // only bars after the alert was set
    const up = ALERT_TYPES[a.type].dir === 'up';
    if (up ? last.close > a.level : last.close < a.level) {
      a.triggered = Date.now(); a.close = last.close; a.barTime = last.time; a.seen = false;
      if (a.type === 'breakout' && bars.length > 51) {
        let s = 0; for (let i = bars.length - 51; i < bars.length - 1; i++) s += bars[i].volume;
        a.volRatio = s ? last.volume / (s / 50) : null;
      }
      hits.push(a);
    }
  }
  if (hits.length) { await save(); notify(hits, name); }
  return hits;
}

export function describe(a, name = '') {
  if (a.type === 'plan' || a.type === 'signal') return a.body || a.title || '';
  const what = a.type === 'breakout' ? `broke out above ${a.level}` : a.type === 'stop' ? `hit its stop (${a.level})` : a.type === 'above' ? `closed above ${a.level}` : `closed below ${a.level}`;
  return `${a.sym}${name ? ' (' + name + ')' : ''} ${what}: close ${a.close}${a.volRatio ? `, volume ×${a.volRatio.toFixed(1)} of average${a.volRatio >= 1.5 ? '' : ' (below the +50% a confirmed breakout needs)'}` : ''}.`;
}

async function notifyRaw(title, body) {
  if (isDesktop()) { try { new Notification(title, { body }); } catch (e) { /* not allowed */ } return; }
  if (!Capacitor.isNativePlatform()) return;
  try { await LocalNotifications.schedule({ notifications: [{ id: Date.now() % 2e9, title, body }] }); } catch (e) { /* permission refused */ }
}

async function notify(hits, name) {
  if (isDesktop()) { // desktop app: system notifications through the web Notification API
    try { hits.forEach(a => new Notification(a.type === 'stop' ? 'Stop alert' : 'Price alert', { body: describe(a, name) })); } catch (e) { /* not allowed */ }
    return;
  }
  if (!Capacitor.isNativePlatform()) return;
  try {
    await LocalNotifications.schedule({ notifications: hits.map((a, i) => ({ id: (Date.now() % 2e9) + i, title: a.type === 'stop' ? 'Stop alert' : 'Price alert', body: describe(a, name) })) });
  } catch (e) { /* permission refused */ }
}

/** Loads every stock with an active alert and checks it. onProgress(i, n). */
export async function checkAll(onProgress) {
  const planSyms = planHook ? await planHook.syms() : [];
  const syms = [...new Set([...(await allAlerts()).filter(x => !x.triggered && x.type !== 'plan').map(x => x.sym), ...planSyms])], hits = [];
  for (let i = 0; i < syms.length; i++) {
    onProgress && onProgress(i + 1, syms.length);
    try { const d = await daily(syms[i]); hits.push(...await checkBars(syms[i], d.bars, d.name)); } catch (e) { /* skip */ }
  }
  return hits;
}
