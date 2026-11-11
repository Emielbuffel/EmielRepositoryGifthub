// Persistence. Settings, watchlist, holdings and drawings go to Capacitor Preferences on iOS/macOS
// (UserDefaults, kept with the app) and localStorage in a browser. Price history is a cache in IndexedDB.
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

const native = Capacitor.isNativePlatform();
const mem = new Map(); // fallback when storage is blocked (private windows)

export async function get(key, def) {
  try {
    if (native) { const { value } = await Preferences.get({ key }); return value == null ? def : JSON.parse(value); }
    const v = localStorage.getItem('bpd.' + key); return v == null ? def : JSON.parse(v);
  } catch (e) { return mem.has(key) ? mem.get(key) : def; }
}

/** Called after every save (the sync notes which data changed); `quiet` saves (from the sync itself) skip it. */
let onSet = null;
export const setHook = fn => { onSet = fn; };

export async function set(key, value, { quiet = false } = {}) {
  mem.set(key, value);
  if (!quiet && onSet) { try { onSet(key); } catch (e) { /* ignore */ } }
  try {
    if (native) await Preferences.set({ key, value: JSON.stringify(value) });
    else localStorage.setItem('bpd.' + key, JSON.stringify(value));
  } catch (e) { /* kept in memory for this session */ }
}

export async function remove(key) {
  mem.delete(key);
  try { if (native) await Preferences.remove({ key }); else localStorage.removeItem('bpd.' + key); } catch (e) { /* ignore */ }
}

/** Every key saved on this device. */
export async function keys() {
  try {
    if (native) return (await Preferences.keys()).keys;
    const out = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('bpd.')) out.push(k.slice(4)); }
    return out;
  } catch (e) { return [...mem.keys()]; }
}

/* ---------- IndexedDB cache for price history ---------- */
let dbp = null;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    try {
      const r = indexedDB.open('bpd-cache', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    } catch (e) { rej(e); }
  });
  return dbp;
}

export async function cacheGet(key) {
  try {
    const d = await db();
    return await new Promise((res, rej) => { const q = d.transaction('kv').objectStore('kv').get(key); q.onsuccess = () => res(q.result ?? null); q.onerror = () => rej(q.error); });
  } catch (e) { return mem.get('cache:' + key) ?? null; }
}

export async function cacheSet(key, value) {
  try {
    const d = await db();
    await new Promise((res, rej) => { const tx = d.transaction('kv', 'readwrite'); tx.objectStore('kv').put(value, key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  } catch (e) { mem.set('cache:' + key, value); }
}

export async function cacheClear() {
  try { const d = await db(); await new Promise(res => { const tx = d.transaction('kv', 'readwrite'); tx.objectStore('kv').clear(); tx.oncomplete = res; tx.onerror = res; }); } catch (e) { /* ignore */ }
  [...mem.keys()].filter(k => k.startsWith('cache:')).forEach(k => mem.delete(k));
}
