// "Add this stock": on the page on claude.ai, a stock that is not in the built-in data can be asked for. The request is
// stored in the page's database (requests/<ticker>); the evening task fetches the stock's prices from the free feed, adds it
// to the built-in data for good and deletes the request. So a requested stock is there the next morning.
let dbP = null;
function db() {
  if (!dbP) {
    const c = typeof window !== 'undefined' && window.claude;
    dbP = c && typeof c.use === 'function' ? c.use('db').catch(() => null) : Promise.resolve(null);
  }
  return dbP;
}

/** Can stocks be requested here (the page on claude.ai with its database)? */
export async function canRequest() { return !!(await db()); }

/** All open requests: {SYM: {sym, name, at}}. */
export async function requests() {
  const d = await db(); if (!d) return {};
  try { const snap = await d.collection('requests').get(); const out = {}; snap.docs.forEach(x => { const v = x.data(); if (v && v.sym) out[v.sym] = v; }); return out; }
  catch (e) { return {}; }
}

/** Asks for a stock to be added tonight. */
export async function requestStock(sym, name = '') {
  const d = await db(); if (!d) throw new Error('Requests only work on the page on claude.ai.');
  const id = sym.toUpperCase().replace(/[^A-Z0-9.^-]/g, '');
  if (!id) throw new Error('Not a ticker: ' + sym);
  await d.collection('requests').doc(id.replace(/\./g, '_')).set({ sym: id, name: String(name || '').slice(0, 120), at: Date.now() });
  return id;
}
