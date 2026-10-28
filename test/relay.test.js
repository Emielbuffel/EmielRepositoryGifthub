import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/relay.js';

const req = (q, h = {}) => new Request('https://desk.pages.dev/relay?' + q, { headers: h });

test('relay: ping, key, allowed hosts, crumb', async () => {
  let r = await onRequest({ request: req('ping=1'), env: {} });
  assert.deepEqual(await r.json(), { ok: true, keyRequired: false, keyOk: true });
  r = await onRequest({ request: req('ping=1'), env: { RELAY_KEY: 's3cret' } });
  assert.equal((await r.json()).keyOk, false);
  r = await onRequest({ request: req('url=' + encodeURIComponent('https://query1.finance.yahoo.com/x')), env: { RELAY_KEY: 's3cret' } });
  assert.equal(r.status, 401);
  r = await onRequest({ request: req('url=' + encodeURIComponent('https://evil.example.com/')), env: {} });
  assert.equal(r.status, 403);
  const seen = [], real = globalThis.fetch;
  globalThis.fetch = async (u, o) => {
    seen.push(String(u));
    if (String(u).startsWith('https://fc.yahoo.com')) return new Response('', { status: 404, headers: { 'set-cookie': 'A3=abc; Path=/' } });
    if (String(u).includes('getcrumb')) return new Response('CRUMB1');
    return new Response('{"ok":1}', { headers: { 'Content-Type': 'application/json' } });
  };
  try {
    r = await onRequest({ request: req('url=' + encodeURIComponent('https://query2.finance.yahoo.com/v10/finance/quoteSummary/SN?modules=price&crumb=__CRUMB__'), { 'x-relay-key': 's3cret' }), env: { RELAY_KEY: 's3cret' } });
    assert.equal(r.status, 200); assert.equal(await r.text(), '{"ok":1}');
    assert.ok(seen.some(u => u.includes('crumb=CRUMB1')));
  } finally { globalThis.fetch = real; }
});
