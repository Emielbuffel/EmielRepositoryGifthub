// Data relay for the web/phone version (Cloudflare Pages Function, free plan). Browsers may not read Yahoo Finance,
// SEC EDGAR or news feeds directly (CORS), so the app asks this function on its own site to fetch them.
//   GET /relay?url=<encoded https URL>     headers: x-relay-key (when RELAY_KEY is set), x-relay-ua (User-Agent)
//   GET /relay?ping=1                      -> {ok, keyRequired}
// Only the data hosts the app uses are allowed. Set RELAY_KEY in the Cloudflare dashboard (Settings → Variables)
// so other people can't use your relay; enter the same key in the app (Settings → Data).
const ALLOW = /^(query1\.finance\.yahoo\.com|query2\.finance\.yahoo\.com|fc\.yahoo\.com|feeds\.finance\.yahoo\.com|finance\.yahoo\.com|www\.sec\.gov|data\.sec\.gov|stooq\.com|stooq\.pl|www\.nasdaq\.com|news\.google\.com|financialmodelingprep\.com)$/i;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const yh = { cookie: '', crumb: '', at: 0 };

async function yahooCrumb(force) {
  if (!force && yh.crumb && Date.now() - yh.at < 6 * 3600e3) return yh;
  const r = await fetch('https://fc.yahoo.com/', { headers: { 'User-Agent': UA }, redirect: 'manual' }).catch(() => null);
  const raw = r ? (r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie') || '']) : [];
  yh.cookie = raw.filter(Boolean).map(c => c.split(';')[0]).join('; ');
  const c = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', { headers: { 'User-Agent': UA, Cookie: yh.cookie } });
  yh.crumb = c.ok ? (await c.text()).trim() : ''; yh.at = Date.now();
  return yh;
}

const cors = req => ({ 'Access-Control-Allow-Origin': req.headers.get('Origin') || '*', 'Access-Control-Allow-Headers': 'x-relay-key, x-relay-ua', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Vary': 'Origin' });

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors(request) });
  const q = new URL(request.url).searchParams, key = env.RELAY_KEY || '';
  if (q.get('ping')) return Response.json({ ok: true, keyRequired: !!key, keyOk: !key || request.headers.get('x-relay-key') === key }, { headers: cors(request) });
  if (key && request.headers.get('x-relay-key') !== key) return new Response('Relay key missing or wrong', { status: 401, headers: cors(request) });
  let target; try { target = new URL(q.get('url') || ''); } catch (e) { return new Response('Bad url', { status: 400, headers: cors(request) }); }
  if (target.protocol !== 'https:' || !ALLOW.test(target.hostname)) return new Response('Host not allowed', { status: 403, headers: cors(request) });
  const go = async force => {
    let u = target.toString(); const h = { 'User-Agent': request.headers.get('x-relay-ua') || UA, 'Accept-Language': 'en-US,en;q=0.9', Accept: '*/*' };
    if (u.includes('crumb=__CRUMB__')) { const y = await yahooCrumb(force); u = u.replace('__CRUMB__', encodeURIComponent(y.crumb)); if (y.cookie) h.Cookie = y.cookie; }
    return fetch(u, { headers: h, redirect: 'follow', cf: { cacheTtl: 60 } });
  };
  let r = await go(false);
  if ((r.status === 401 || r.status === 403) && target.toString().includes('crumb=__CRUMB__')) r = await go(true);
  return new Response(await r.arrayBuffer(), { status: r.status, headers: { ...cors(request), 'Content-Type': r.headers.get('Content-Type') || 'text/plain', 'Cache-Control': 'no-store' } });
}
