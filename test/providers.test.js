// Provider parsing against the response shapes in each provider's documentation (network mocked).
import test from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDERS, splitSym, currencyOf } from '../src/data/providers.js';

function mock(handler) {
  const calls = [];
  globalThis.fetch = async url => { calls.push(String(url)); const { status = 200, body } = handler(String(url)); return { status, text: async () => typeof body === 'string' ? body : JSON.stringify(body) }; };
  return calls;
}

test('ticker suffixes map to currencies', () => {
  assert.deepEqual(splitSym('ASML.AS'), { base: 'ASML', sfx: 'AS' });
  assert.deepEqual(splitSym('BRK.B'), { base: 'BRK.B', sfx: '' });
  assert.equal(currencyOf('VOD.L'), 'GBp');
  assert.equal(currencyOf('005930.KS'), 'KRW');
  assert.equal(currencyOf('AAPL'), 'USD');
});

test('FMP stable historical-price-eod/full', async () => {
  const calls = mock(() => ({ body: [{ symbol: 'AAPL', date: '2026-10-22', open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 }, { symbol: 'AAPL', date: '2026-10-21', open: 1, high: 1.2, low: 0.9, close: 1, volume: 90 }] }));
  const r = await PROVIDERS.fmp.daily('AAPL', 'KEY', 1700000000);
  assert.equal(r.bars.length, 2); assert.ok(r.bars[0].time < r.bars[1].time); assert.equal(r.bars[1].close, 1.5);
  assert.match(calls[0], /financialmodelingprep\.com\/stable\/historical-price-eod\/full\?symbol=AAPL&from=2023-11-14&apikey=KEY/);
});

test('FMP errors become readable messages', async () => {
  mock(() => ({ status: 401, body: { 'Error Message': 'Invalid API KEY.' } }));
  await assert.rejects(PROVIDERS.fmp.daily('AAPL', 'BAD'), e => e.kind === 'auth' && /Invalid API KEY/.test(e.message));
});

test('Twelve Data time_series with string values and mic codes', async () => {
  const calls = mock(() => ({ body: { meta: { symbol: 'ASML', currency: 'EUR', exchange: 'Euronext' }, values: [{ datetime: '2026-10-21', open: '600.1', high: '610', low: '590', close: '605.5', volume: '1200' }, { datetime: '2026-10-22', open: '605', high: '612', low: '601', close: '611', volume: '1500' }], status: 'ok' } }));
  const r = await PROVIDERS.twelvedata.daily('ASML.AS', 'KEY');
  assert.equal(r.currency, 'EUR'); assert.equal(r.bars[1].close, 611); assert.equal(r.bars[0].volume, 1200);
  assert.match(calls[0], /symbol=ASML&.*mic_code=XAMS/);
});

test('Twelve Data error body', async () => {
  mock(() => ({ body: { code: 429, message: 'You have run out of API credits for the current minute.', status: 'error' } }));
  await assert.rejects(PROVIDERS.twelvedata.daily('AAPL', 'KEY'), e => e.kind === 'limit');
});

test('EODHD eod with split adjustment and exchange codes', async () => {
  const calls = mock(() => ({ body: [{ date: '2026-10-21', open: 200, high: 210, low: 190, close: 200, adjusted_close: 100, volume: 1000 }, { date: '2026-10-22', open: 101, high: 104, low: 100, close: 103, adjusted_close: 103, volume: 3000 }] }));
  const r = await PROVIDERS.eodhd.daily('VOD.L', 'KEY');
  assert.equal(r.bars[0].close, 100); assert.equal(r.bars[0].high, 105); assert.equal(r.bars[0].volume, 2000);
  assert.match(calls[0], /eodhd\.com\/api\/eod\/VOD\.LSE\?/);
});

test('search results map back to app tickers', async () => {
  mock(() => ({ body: { data: [{ symbol: '7203', instrument_name: 'Toyota Motor Corp', exchange: 'JPX', mic_code: 'XJPX', currency: 'JPY', country: 'Japan', instrument_type: 'Common Stock' }, { symbol: 'AAPL', instrument_name: 'Apple Inc', exchange: 'NASDAQ', mic_code: 'XNGS', currency: 'USD', country: 'United States', instrument_type: 'Common Stock' }] } }));
  const r = await PROVIDERS.twelvedata.search('toyota');
  assert.deepEqual(r.map(x => x.symbol), ['7203.T', 'AAPL']);
});
