// News: read on the device from free public feeds every time a stock is opened, without any server.
// Shows headline, source, time and a link to the original article; never copies article text.
// Each source can be switched off in Settings. Feed formats change without notice, so every source
// fails quietly on its own.
import { httpGet, isApp } from './net.js';
import { PROVIDERS, splitSym } from './providers.js';
import { settings, provider, isDemoSym, isDemo, secAgent } from './service.js';
import * as store from './store.js';

// SEC asks automated tools to identify themselves with a contact address (sec.gov "Accessing EDGAR Data").
// Replace with your app's support e-mail before release.

export const NEWS_SOURCES = {
  yahoo: { name: 'Yahoo Finance', about: 'Headlines per ticker from Yahoo Finance’s public RSS feed.' },
  nasdaq: { name: 'Nasdaq.com', about: 'Nasdaq’s public RSS feed per US ticker.' },
  google: { name: 'Google News', about: 'Google News search feed for the company name: many outlets, some paywalled (filtered below).' },
  sec: { name: 'SEC filings (EDGAR)', about: 'Official US filings: 8-K (material events), 10-Q, 10-K, ownership reports. Public data from sec.gov.' },
  provider: { name: 'Your data provider', about: 'Company news from FMP or EODHD when your plan includes it.' },
};
export const newsSettings = () => {
  const n = settings.news || {};
  return { sources: { yahoo: true, nasdaq: true, google: true, sec: true, provider: true, ...(n.sources || {}) }, hidePaywalled: n.hidePaywalled !== false, custom: n.custom || [] };
};

// Sites whose articles usually need a subscription
const PAYWALLED = ['wsj.com', 'ft.com', 'bloomberg.com', 'barrons.com', 'economist.com', 'nytimes.com', 'washingtonpost.com', 'investors.com', 'theinformation.com', 'seekingalpha.com', 'thetimes.co.uk', 'telegraph.co.uk', 'handelsblatt.com', 'lesechos.fr', 'nikkei.com', 'asia.nikkei.com', 'businessinsider.com', 'fortune.com', 'theathletic.com', 'morningstar.com/premium', 'marketwatch.com', 'faz.net', 'nzz.ch', 'tijd.be', 'fd.nl'];
export const isPaywalled = domain => !!domain && PAYWALLED.some(d => domain === d || domain.endsWith('.' + d));

/* ---------- feed parsing (RSS 2.0 and Atom) without a DOM, so it also runs in tests ---------- */
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export const decode = s => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/<[^>]+>/g, '') // markup first, so escaped text such as &lt;500&gt; survives
  .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e.toLowerCase()] ?? m)
  .replace(/\s+/g, ' ').trim();
const tag = (x, t) => { const m = new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)</${t}>`, 'i').exec(x); return m ? m[1] : ''; };
const attr = (x, t, a) => { const m = new RegExp(`<${t}\\b[^>]*\\b${a}=["']([^"']+)["']`, 'i').exec(x); return m ? decode(m[1]) : ''; };
export const domainOf = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };

export function parseFeed(xml) {
  const out = [];
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) || xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
  for (const b of blocks) {
    const title = decode(tag(b, 'title'));
    let link = decode(tag(b, 'link')) || attr(b, 'link', 'href');
    const date = Date.parse(decode(tag(b, 'pubDate') || tag(b, 'updated') || tag(b, 'published') || tag(b, 'dc:date')));
    const srcName = decode(tag(b, 'source')), srcUrl = attr(b, 'source', 'url');
    const cat = attr(b, 'category', 'term') || decode(tag(b, 'category'));
    if (title && link) out.push({ title, link, date: isFinite(date) ? date : null, source: srcName, srcDomain: srcUrl ? domainOf(srcUrl) : '', cat });
  }
  return out;
}

/* ---------- tagging ---------- */
const TAGS = [
  ['filing', /\b(8-K|10-Q|10-K|6-K|20-F|S-1|13D|13G|DEF 14A)\b/],
  ['earnings', /\b(earnings|EPS|quarterly results|results|revenue|profit|beats?|miss(es)?|guidance|outlook|forecast)\b/i],
  ['analyst', /\b(upgrade[sd]?|downgrade[sd]?|price target|initiat\w+ coverage|outperform|underperform|overweight|underweight|analyst)\b/i],
  ['deal', /\b(acqui\w+|merger|takeover|buyout|stake|deal|spin-?off|IPO)\b/i],
  ['product', /\b(launch\w*|unveil\w*|introduc\w+|new product|approval|FDA|contract)\b/i],
];
export const classify = t => (TAGS.find(([, re]) => re.test(t)) || ['other'])[0];
const norm = t => t.toLowerCase().replace(/\s[-–|]\s[^-–|]{2,40}$/, '').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

/* ---------- fetching ---------- */
async function getText(url, headers = {}) {
  if (isApp()) {
    const r = await httpGet(url, { headers, timeout: 15000 });
    if (r.status >= 400) throw new Error('HTTP ' + r.status);
    return r.text;
  }
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 12000);
  try { const r = await fetch(url, { signal: ctl.signal }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.text(); }
  finally { clearTimeout(t); }
}

const SEC_FORMS = /^(8-K|10-Q|10-K|6-K|20-F|S-1|SC 13D|SC 13G|DEF 14A|SC TO)/;
function stockFeeds(sym, name) {
  const { base, sfx } = splitSym(sym), us = !sfx, S = newsSettings().sources, out = [];
  const company = (name || '').replace(/,? (Inc|Corp|Corporation|Ltd|plc|N\.V\.|SE|AG|SA|S\.A\.|Co|Holdings?)\.?$/i, '').trim();
  if (S.yahoo) out.push(['yahoo', `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(sym)}&region=US&lang=en-US`, it => ({ ...it, source: it.source || 'Yahoo Finance' })]);
  if (S.nasdaq && us) out.push(['nasdaq', `https://www.nasdaq.com/feed/rssoutbound?symbol=${encodeURIComponent(base)}`, it => ({ ...it, source: it.source || 'Nasdaq' })]);
  if (S.google) {
    const q = company ? `"${company}" (stock OR shares OR earnings) when:30d` : `${base} stock when:30d`;
    out.push(['google', `https://news.google.com/rss/search?${new URLSearchParams({ q, hl: 'en-US', gl: 'US', ceid: 'US:en' })}`, it => ({ ...it, title: it.title.replace(/\s-\s[^-]+$/, ''), source: it.source || 'Google News' })]);
  }
  if (S.sec && us) out.push(['sec', `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(base)}&type=&dateb=&owner=include&count=25&output=atom`,
    it => SEC_FORMS.test(it.cat || it.title) ? { ...it, title: 'Filed ' + it.title.replace(/\s*\(.*?\)\s*/g, ' ').trim(), source: 'SEC EDGAR', srcDomain: 'sec.gov', tag: 'filing' } : null, { 'User-Agent': secAgent() }]);
  newsSettings().custom.forEach((u, i) => { if (/^https:\/\//.test(u)) out.push(['custom' + i, u.replace(/\{SYMBOL\}/g, encodeURIComponent(sym)).replace(/\{TICKER\}/g, encodeURIComponent(base)), it => ({ ...it, source: it.source || domainOf(it.link) })]); });
  return out;
}

const MARKET_FEEDS = [
  ['yahoo', 'https://finance.yahoo.com/news/rssindex', it => ({ ...it, source: it.source || 'Yahoo Finance' })],
  ['nasdaq', 'https://www.nasdaq.com/feed/rssoutbound?category=Markets', it => ({ ...it, source: it.source || 'Nasdaq' })],
  ['google', `https://news.google.com/rss/search?${new URLSearchParams({ q: '"stock market" OR "Wall Street" OR Nasdaq OR "S&P 500" when:2d', hl: 'en-US', gl: 'US', ceid: 'US:en' })}`, it => ({ ...it, title: it.title.replace(/\s-\s[^-]+$/, ''), source: it.source || 'Google News' })],
];

async function collect(feeds, extra = []) {
  const errors = [], all = [...extra];
  await Promise.all(feeds.map(async ([id, url, map, headers]) => {
    try { const items = parseFeed(await getText(url, headers)); items.forEach(it => { const x = map(it); if (x) all.push({ ...x, via: id }); }); }
    catch (e) { errors.push(id); }
  }));
  const ns = newsSettings(), seen = new Set(), out = [];
  for (const it of all.sort((a, b) => (b.date || 0) - (a.date || 0))) {
    const k = norm(it.title); if (!k || seen.has(k)) continue; seen.add(k);
    const domain = it.srcDomain || domainOf(it.link);
    const pw = isPaywalled(domain) || isPaywalled(domainOf(it.link));
    if (pw && ns.hidePaywalled) continue;
    out.push({ ...it, domain, paywalled: pw, tag: it.tag || classify(it.title) });
  }
  return { items: out.slice(0, 60), errors, at: Date.now(), browserBlocked: !isApp() && errors.length === feeds.length && feeds.length > 0 };
}

const mem = new Map();
/** Company news for a ticker. Always fetches fresh (cached results come back first via onCached). */
export async function stockNews(sym, name, onCached) {
  const ck = 'news:' + sym;
  const prev = mem.get(ck) || await store.cacheGet(ck);
  if (prev && onCached) onCached(prev);
  if (isDemoSym(sym)) { const r = { items: (await PROVIDERS.demo.news(sym)).map(x => ({ ...x, tag: x.tag || classify(x.title) })), errors: [], at: Date.now(), demo: true }; mem.set(ck, r); return r; }
  let extra = [];
  const P = provider();
  if (newsSettings().sources.provider && P.news && settings.keys[P.id]) {
    try { extra = (await P.news(sym, settings.keys[P.id])).filter(x => x.title && x.link).map(x => ({ ...x, via: 'provider' })); } catch (e) { /* not on this plan */ }
  }
  const r = await collect(stockFeeds(sym, name), extra);
  if (!r.items.length && prev && prev.items.length) return { ...prev, errors: r.errors, stale: true };
  mem.set(ck, r); await store.cacheSet(ck, r);
  return r;
}

/** General market headlines for the Market tab. */
export async function marketNews() {
  if (isDemo()) return { items: [], errors: [], at: Date.now(), demo: true };
  const S = newsSettings().sources;
  return collect(MARKET_FEEDS.filter(([id]) => S[id]));
}

/** Last time the user looked at this stock's news, to mark newer headlines as NEW. */
export async function lastSeen(sym) { return (await store.get('newsSeen', {}))[sym] || 0; }
export async function markSeen(sym) { const m = await store.get('newsSeen', {}); m[sym] = Date.now(); const keys = Object.keys(m); if (keys.length > 400) delete m[keys[0]]; await store.set('newsSeen', m); }
