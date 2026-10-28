// Network access. The desktop app (Electron) and the iPhone/Mac app make requests outside the browser, so
// the free data feeds (Yahoo Finance, SEC EDGAR, news) work there; a plain web page is limited by CORS.
import { Capacitor, CapacitorHttp } from '@capacitor/core';

export const isDesktop = () => typeof window !== 'undefined' && !!window.desktop;
/** Data relay on the app's own website (web/phone version): {url, key}. Set by settings or detected at start. */
export const relay = { url: '', key: '' };
/** True when the free feeds can be reached: desktop or native app, or a web version with its data relay. */
export const isApp = () => isDesktop() || Capacitor.isNativePlatform() || !!relay.url;
/** Looks for the relay next to the web app (https sites such as Cloudflare Pages); returns the ping answer or null. */
export async function detectRelay() {
  if (isDesktop() || Capacitor.isNativePlatform() || relay.url || typeof location === 'undefined' || location.protocol !== 'https:') return null;
  try {
    const u = new URL('relay', location.href).href, r = await fetch(u + '?ping=1', { headers: relay.key ? { 'x-relay-key': relay.key } : {} });
    const j = r.ok ? await r.json() : null;
    if (j && j.ok && j.keyOk) relay.url = u;
    return j;
  } catch (e) { return null; }
}

/** GET a URL as text. Returns {status, text}. Throws on network failure. */
export async function httpGet(url, { headers = {}, timeout = 30000 } = {}) {
  if (isDesktop()) return window.desktop.get(url, headers, timeout);
  if (Capacitor.isNativePlatform()) {
    const r = await CapacitorHttp.get({ url, headers, responseType: 'text', connectTimeout: 15000, readTimeout: timeout });
    return { status: r.status, text: typeof r.data === 'string' ? r.data : JSON.stringify(r.data) };
  }
  if (relay.url) {
    const r = await fetch(relay.url + '?url=' + encodeURIComponent(url), { headers: { 'x-relay-key': relay.key || '', 'x-relay-ua': headers['User-Agent'] || '' } });
    return { status: r.status, text: await r.text() };
  }
  const r = await fetch(url, { headers });
  return { status: r.status, text: await r.text() };
}

/** Runs fn over items with at most `n` at a time; onEach(i) after each item. */
export async function pool(items, n, fn, onEach) {
  let next = 0, done = 0;
  const worker = async () => { while (next < items.length) { const i = next++; try { await fn(items[i], i); } finally { done++; onEach && onEach(done); } } };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
}
