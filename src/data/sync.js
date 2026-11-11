// Keeps your data the same on the Mac app, the iPhone app and the page on claude.ai: watchlists, holdings, cash,
// buying plans, journal, statements, alerts, drawings, plan settings, the financial plan.
// Two places to keep it:
//  - a private GitHub Gist in your GitHub account (a GitHub token with only the "gist" permission, entered in
//    Settings on each device): works in the Mac app, the iPhone app and the website version;
//  - on claude.ai, your own private storage of the page (no token needed; only you can read it).
// Prices, scans and secrets (API keys, tokens) stay on each device.
import * as store from './store.js';
import { mergeBundles, syncable } from '../core/syncmerge.js';
import { settings } from './service.js';

const FILE = 'base-pattern-desk-sync.json', DESC = 'Base Pattern Desk sync (private)';
const S = { mt: null, timer: null, running: false, dirty: false, listeners: new Set(), db: undefined };
export const onSyncStatus = fn => { S.listeners.add(fn); return () => S.listeners.delete(fn); };
const tell = st => S.listeners.forEach(f => { try { f(st); } catch (e) { /* ignore */ } });

async function mtimes() { if (!S.mt) S.mt = await store.get('sync.mtimes', {}); return S.mt; }
/** Called by the store after every save: note the time, and sync a little later. */
store.setHook(key => {
  if (!syncable(key)) return;
  mtimes().then(m => { m[key] = Date.now(); store.set('sync.mtimes', m, { quiet: true }); });
  S.dirty = true; clearTimeout(S.timer); S.timer = setTimeout(() => syncNow({ reason: 'change' }).catch(() => {}), 20000);
});

/** This device's data: {key: {t, v}}. */
async function localBundle() {
  const m = await mtimes(), out = {};
  for (const k of await store.keys()) {
    if (!syncable(k)) continue;
    const v = await store.get(k, undefined); if (v === undefined) continue;
    out[k] = { t: m[k] || 0, v };
  }
  return out;
}

/* ---------- the GitHub Gist ---------- */
const gh = (path, opts = {}) => fetch('https://api.github.com' + path, { ...opts, headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + settings.keys.gist.trim(), ...(opts.body ? { 'Content-Type': 'application/json' } : {}) } })
  .then(async r => { if (r.status === 401) throw new Error('GitHub refused the token (expired, or without the "gist" permission).'); if (!r.ok) throw new Error('GitHub answered ' + r.status + '.'); return r.status === 204 ? null : r.json(); });
const gist = {
  name: 'your private GitHub Gist',
  ok: () => !!(settings.keys && settings.keys.gist && settings.keys.gist.trim()),
  async find() {
    let id = await store.get('sync.gistId', null);
    if (id) return id;
    for (let page = 1; page <= 5 && !id; page++) { const L = await gh(`/gists?per_page=100&page=${page}`); const g = (L || []).find(x => x.description === DESC && x.files && x.files[FILE]); if (g) id = g.id; if (!L || L.length < 100) break; }
    if (id) await store.set('sync.gistId', id, { quiet: true });
    return id;
  },
  async pull() {
    const id = await this.find(); if (!id) return null;
    const g = await gh('/gists/' + id), f = g.files && g.files[FILE]; if (!f) return null;
    const text = f.truncated ? await fetch(f.raw_url).then(r => r.text()) : f.content;
    return JSON.parse(text || '{}').items || {};
  },
  async push(items) {
    const body = JSON.stringify({ description: DESC, files: { [FILE]: { content: JSON.stringify({ app: 'Base Pattern Desk', v: 1, at: Date.now(), items }) } } });
    const id = await this.find();
    if (id) await gh('/gists/' + id, { method: 'PATCH', body });
    else { const g = await gh('/gists', { method: 'POST', body: JSON.stringify({ ...JSON.parse(body), public: false }) }); await store.set('sync.gistId', g.id, { quiet: true }); }
  },
};

/* ---------- the page's private storage on claude.ai ---------- */
async function claudeDb() {
  if (S.db !== undefined) return S.db;
  S.db = null;
  const c = typeof window !== 'undefined' && window.claude;
  if (c && typeof c.use === 'function') {
    try { const [db, user] = await Promise.all([c.use('db'), c.use('user')]); const id = user && await user.id(); if (db && id) S.db = { db, col: 'data/users/' + id }; } catch (e) { /* not available */ }
  }
  return S.db;
}
const CHUNK = 200000; // characters per stored document (a document holds at most 256 KB)
const docId = k => 'sync-' + k.replace(/[^A-Za-z0-9_.~:@+-]/g, '_');
const claude = {
  name: 'your private storage on claude.ai',
  async pull() {
    const d = await claudeDb(); if (!d) return null;
    const snap = await d.db.collection(d.col).get(), parts = {}, out = {};
    snap.docs.forEach(x => { const b = x.data(); if (b && b.k) (parts[b.k] = parts[b.k] || []).push(b); });
    for (const [k, list] of Object.entries(parts)) {
      list.sort((a, b) => (a.i || 0) - (b.i || 0));
      const head = list.find(x => !x.i); if (!head || list.length !== head.n) continue; // incomplete: skip this time
      try { out[k] = { t: head.t, v: JSON.parse(list.map(x => x.s).join('')) }; } catch (e) { /* broken: skip */ }
    }
    return out;
  },
  async push(items, changed) {
    const d = await claudeDb(); if (!d) return;
    for (const k of changed) {
      const it = items[k], s = JSON.stringify(it.v), n = Math.max(1, Math.ceil(s.length / CHUNK));
      for (let i = 0; i < n; i++) await d.db.collection(d.col).doc(docId(k) + (i ? '--' + i : '')).set({ k, t: it.t, n, i, s: s.slice(i * CHUNK, (i + 1) * CHUNK) });
    }
  },
};

/** Which places are in use on this device. */
export async function syncTargets() { const t = []; if (gist.ok()) t.push(gist); if (await claudeDb()) t.push(claude); return t; }

/** One sync: pull, merge, save what is newer, push what the other side lacks. Returns a status. */
export async function syncNow({ reason = 'manual' } = {}) {
  if (S.running) return null;
  const targets = await syncTargets();
  if (!targets.length) return null;
  S.running = true; tell({ busy: true });
  const status = { at: Date.now(), ok: true, applied: 0, pushed: false, places: targets.map(t => t.name), msg: '' };
  try {
    let local = await localBundle();
    for (const T of targets) {
      const joined = await store.get('sync.joined.' + (T === gist ? 'gist' : 'claude'), false);
      const remote = await T.pull() || {};
      const { apply, push, merged } = mergeBundles(local, remote, { joining: !joined && Object.keys(remote).length > 0 });
      const m = await mtimes();
      for (const [k, it] of Object.entries(apply)) { await store.set(k, it.v, { quiet: true }); m[k] = it.t || Date.now(); status.applied++; }
      if (Object.keys(apply).length) await store.set('sync.mtimes', m, { quiet: true });
      const changed = Object.keys(merged).filter(k => !remote[k] || JSON.stringify(remote[k].v) !== JSON.stringify(merged[k].v) || (remote[k].t || 0) !== (merged[k].t || 0));
      if (push || changed.length) { await T.push(merged, changed); status.pushed = true; }
      await store.set('sync.joined.' + (T === gist ? 'gist' : 'claude'), true, { quiet: true });
      local = merged;
    }
    S.dirty = false;
  } catch (e) { status.ok = false; status.msg = e.message || String(e); }
  S.running = false;
  await store.set('sync.status', status, { quiet: true });
  tell(status);
  // data from another device: reload so every tab shows it (not while a sheet is open)
  if (status.applied && reason !== 'manual-noreload') {
    const go = () => { const sh = document.getElementById('sheet'); if (sh && !sh.hidden) setTimeout(go, 3000); else location.reload(); };
    setTimeout(go, 1200);
  }
  return status;
}

/** Sync at start, every 5 minutes, and when the app comes back to the front. */
export function startSync() {
  setTimeout(() => syncNow({ reason: 'start' }).catch(() => {}), 2500);
  setInterval(() => syncNow({ reason: 'timer' }).catch(() => {}), 5 * 60e3);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow({ reason: 'visible' }).catch(() => {}); });
}
