// Network access. The desktop app (Electron) and the iPhone/Mac app make requests outside the browser, so
// the free data feeds (Yahoo Finance, SEC EDGAR, news) work there; a plain web page is limited by CORS.
import { Capacitor, CapacitorHttp } from '@capacitor/core';

export const isDesktop = () => typeof window !== 'undefined' && !!window.desktop;
/** True when free feeds can be fetched directly (desktop or native app). */
export const isApp = () => isDesktop() || Capacitor.isNativePlatform();

/** GET a URL as text. Returns {status, text}. Throws on network failure. */
export async function httpGet(url, { headers = {}, timeout = 30000 } = {}) {
  if (isDesktop()) return window.desktop.get(url, headers, timeout);
  if (Capacitor.isNativePlatform()) {
    const r = await CapacitorHttp.get({ url, headers, responseType: 'text', connectTimeout: 15000, readTimeout: timeout });
    return { status: r.status, text: typeof r.data === 'string' ? r.data : JSON.stringify(r.data) };
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
