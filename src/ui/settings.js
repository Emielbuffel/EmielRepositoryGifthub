// Settings: data provider and API key, appearance, cache, privacy and about.
import { PROVIDERS } from '../data/providers.js';
import { settings, saveSettings, daily, provider } from '../data/service.js';
import * as store from '../data/store.js';
import { App, emit, loadState } from '../app.js';
import { NEWS_SOURCES, newsSettings } from '../data/news.js';
import { $, $$, html, raw, render, toast } from './dom.js';

export const VERSION = '1.0.0';

export async function initSettings(el) {
  const theme = await store.get('theme', 'system');
  render(el, html`
    <section class="card">
      <h2>Market data</h2>
      <p class="small" style="margin:0">Choose where prices come from. Real data needs your own API key from one of these providers. The key is stored only on this device and sent only to that provider.</p>
      <div class="provider-list" id="stProv">${Object.values(PROVIDERS).map(p => html`
        <label class="provider${settings.provider === p.id ? ' on' : ''}"><input type="radio" name="prov" value="${p.id}" ${settings.provider === p.id ? raw('checked') : ''}><div><b>${p.name}</b><p>${p.blurb}</p>${p.site ? html`<p><a href="${p.site}" target="_blank" rel="noopener">Get a key at ${new URL(p.site).hostname}</a></p>` : ''}</div></label>`)}</div>
      <div id="stKey"></div>
    </section>
    <section class="card">
      <h2>News sources</h2>
      <p class="small" style="margin:0">The app checks these free sources every time you open a stock or the Market tab. Only headlines and links are shown; articles open on the publisher's site.</p>
      <div class="list" id="stNews">${Object.entries(NEWS_SOURCES).map(([k, x]) => html`<label class="row" style="cursor:pointer"><span><b class="small">${x.name}</b><br><span class="muted tiny">${x.about}</span></span><input type="checkbox" class="switch" data-src="${k}" ${newsSettings().sources[k] ? raw('checked') : ''}></label>`)}
        <label class="row" style="cursor:pointer"><span><b class="small">Hide paywalled sites</b><br><span class="muted tiny">Skips sites that usually need a subscription (WSJ, FT, Bloomberg, Barron's…).</span></span><input type="checkbox" class="switch" id="stPw" ${newsSettings().hidePaywalled ? raw('checked') : ''}></label></div>
      <label class="field"><span>Your own RSS feeds (one per line, https only; {SYMBOL} is replaced by the ticker)</span><textarea class="input" id="stFeeds" rows="2" placeholder="https://example.com/rss?s={SYMBOL}" autocapitalize="off" spellcheck="false">${newsSettings().custom.join('\n')}</textarea></label>
    </section>
    <section class="card">
      <h2>Appearance</h2>
      <div class="seg" role="group" aria-label="Appearance">${[['system', 'Automatic'], ['light', 'Light'], ['dark', 'Dark']].map(([k, l]) => html`<button data-theme="${k}" class="${theme === k ? 'on' : ''}">${l}</button>`)}</div>
    </section>
    <section class="card">
      <h2>Data on this device</h2>
      <p class="small muted" style="margin:0">Prices are cached for 3 hours to save requests on your plan. Your watchlist, holdings and drawings are kept separately for demo and real data.</p>
      <div class="toolbar"><button class="btn" id="stClear">Clear price cache</button><button class="btn danger" id="stReset">Erase all app data</button></div>
    </section>
    <section class="card">
      <h2>Privacy</h2>
      <div class="prose small">
        <p><b>Base Pattern Desk collects no data.</b> There is no account, no analytics, no tracking and no advertising. Your watchlist, holdings, drawings and API key stay on this device.</p>
        <p>To load prices, the app sends the tickers you look at, with your API key, directly to the data provider you chose. To check news, it requests public feeds (for example Yahoo Finance, Nasdaq.com, Google News, SEC EDGAR) with the ticker or company name, but no key or personal data. Each provider's own privacy policy applies. In demo mode the app makes no network requests at all.</p>
      </div>
    </section>
    <section class="card">
      <h2>About</h2>
      <div class="prose small">
        <p><b>Base Pattern Desk ${VERSION}</b>: O'Neil-style base patterns, market direction, a screener and a portfolio risk review.</p>
        <p><b>Not investment advice.</b> The app applies published rules of thumb (William O'Neil, <i>How to Make Money in Stocks</i>) to end-of-day prices for education and research. Signals can be wrong; past patterns don't guarantee future results. Make your own decisions, or talk to a licensed adviser.</p>
        <p>The app is not affiliated with Investor's Business Daily, William O'Neil + Co. or any data provider. CAN SLIM is a registered trademark of Investor's Business Daily, used here only to describe the method.</p>
        <p>Charts by <a href="https://www.tradingview.com/" target="_blank" rel="noopener">TradingView</a> Lightweight Charts™ (Apache License 2.0).</p>
      </div>
    </section>`);
  keyBox();
  $$('input[name=prov]', el).forEach(r => {
    r.onchange = async () => {
      settings.provider = r.value; await saveSettings();
      $$('.provider', el).forEach(x => x.classList.toggle('on', x.querySelector('input').checked));
      keyBox(); await switchProvider();
    };
  });
  $$('[data-theme]', el).forEach(b => {
    b.onclick = async () => { await store.set('theme', b.dataset.theme); applyTheme(b.dataset.theme); $$('[data-theme]', el).forEach(x => x.classList.toggle('on', x === b)); };
  });
  const saveNews = async () => {
    const n = newsSettings();
    $$('[data-src]', el).forEach(c => { n.sources[c.dataset.src] = c.checked; });
    n.hidePaywalled = $('#stPw').checked;
    n.custom = $('#stFeeds').value.split(/\n+/).map(x => x.trim()).filter(x => /^https:\/\/\S+$/.test(x)).slice(0, 10);
    settings.news = n; await saveSettings();
  };
  $$('[data-src]', el).forEach(c => { c.onchange = saveNews; }); $('#stPw').onchange = saveNews; $('#stFeeds').onchange = saveNews;
  $('#stClear').onclick = async () => { await store.cacheClear(); toast('Price cache cleared.'); };
  $('#stReset').onclick = async () => {
    if (!confirm('Erase your watchlists, holdings, drawings, API keys and cached prices from this device?')) return;
    await store.cacheClear();
    for (const k of ['settings', 'watch.demo', 'watch.real', 'holdings.demo', 'holdings.real', 'drawings', 'names', 'lastQuotes', 'chartPrefs', 'theme', 'onboarded', 'lastSym.demo', 'lastSym.real', 'screen.demo', 'screen.fmp', 'screen.twelvedata', 'screen.eodhd', 'portfolio.base', 'screen.custom']) await store.remove(k);
    location.reload();
  };
}

function keyBox() {
  const p = provider(), el = $('#stKey');
  if (!p.needsKey) { render(el, html`<p class="small muted" style="margin:0">Demo mode: fictional companies, no internet needed. Switch to a provider above for real stocks.</p>`); return; }
  render(el, html`<label class="field"><span>${p.name} API key</span><input class="input" id="stKeyIn" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Paste your key" value="${settings.keys[p.id] || ''}"></label>
    <div class="toolbar"><button class="btn primary" id="stSave">Save and test</button><span class="small" id="stMsg"></span></div>`);
  $('#stSave').onclick = async () => {
    settings.keys[p.id] = $('#stKeyIn').value.trim(); await saveSettings();
    const m = $('#stMsg'); m.className = 'small muted'; m.textContent = 'Testing…';
    try { const d = await daily('AAPL', { force: true }); m.className = 'small t-ok'; m.textContent = `Works: AAPL loaded, ${d.bars.length} days of history.`; await switchProvider(); }
    catch (e) { m.className = 'small t-bad'; m.textContent = e.message; }
  };
}

async function switchProvider() { await loadState(); emit('provider'); emit('watch'); }

export function applyTheme(t) {
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  emit('theme');
}
