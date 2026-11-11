// Settings: data provider and API key, appearance, cache, privacy and about.
import { PROVIDERS } from '../data/providers.js';
import { settings, saveSettings, daily, provider, applySite } from '../data/service.js';
import { isDesktop } from '../data/net.js';
import * as store from '../data/store.js';
import { App, emit, loadState } from '../app.js';
import { NEWS_SOURCES, newsSettings } from '../data/news.js';
import { $, $$, html, raw, render, toast } from './dom.js';
import { strategy, saveStrategy } from '../data/plans.js';
import { DEFAULT_PLAN, pyramid } from '../core/strategy.js';
import { COACH_MODELS } from '../data/coach.js';

export const VERSION = '1.0.0';

export async function initSettings(el) {
  const theme = await store.get('theme', 'system');
  const S = await strategy();
  const P100 = x => +(x * 100).toFixed(2);
  render(el, html`
    <section class="card">
      <h2>Market data</h2>
      <p class="small" style="margin:0">Choose where prices come from. The built-in data with free live updates needs no account. The other providers need your own API key, stored only on this device and sent only to that provider.</p>
      <div class="provider-list" id="stProv">${Object.values(PROVIDERS).map(p => html`
        <label class="provider${settings.provider === p.id ? ' on' : ''}"><input type="radio" name="prov" value="${p.id}" ${settings.provider === p.id ? raw('checked') : ''}><div><b>${p.name}</b><p>${p.blurb}</p>${p.site ? html`<p><a href="${p.site}" target="_blank" rel="noopener">Get a key at ${new URL(p.site).hostname}</a></p>` : ''}</div></label>`)}</div>
      <div id="stKey"></div>
      <label class="field"><span>Your e-mail for SEC EDGAR — needed for the long US earnings history (back to about 2009). The SEC refuses requests without a contact e-mail; it is sent only to sec.gov. Without it, US stocks use the shorter built-in history.</span><input class="input" id="stSec" type="email" placeholder="you@example.com" value="${settings.secEmail || ''}" autocapitalize="off" spellcheck="false"></label>
      <h3 style="margin:6px 0 0">Automatic updates</h3>
      <p class="small muted" style="margin:0">In the desktop app prices refresh by themselves: about every 90 seconds for your watchlists and holdings while their market is open (every 30 minutes otherwise), every minute on the open chart, every 5 minutes on the Market tab.</p>
      <label class="field"><span>Screener: scan again automatically every</span><select class="input" id="stAuto">${[[15, '15 minutes'], [30, '30 minutes'], [60, 'hour'], [0, 'never (only when I press Run scan)']].map(([v, l]) => html`<option value="${v}" ${(settings.autoScan ?? 30) === v ? raw('selected') : ''}>${l}</option>`)}</select></label>
      <label class="chk"><input type="checkbox" id="stNotW" ${settings.notifyWatch === false ? '' : raw('checked')}> Also notify when a watchlist stock breaks out into its buy zone (stocks you own always get buy-zone and add-on notifications)</label>
    </section>
    <section class="card" id="stSite">
      <h2>Phone &amp; automatic updates</h2>
      <p class="small" style="margin:0">Your own free website (for example on Cloudflare Pages, connected to your GitHub repository) hosts the newest version of the app. It gives you: the app on your phone (open the address and choose <b>Add to Home Screen</b>), live data there through its built-in data relay, and automatic updates for this ${isDesktop() ? 'desktop app' : 'app'}. Step-by-step guide: docs/PHONE.md in the repository.</p>
      <div class="grid2"><label class="field"><span>Your app website</span><input class="input" id="stSiteUrl" type="url" placeholder="https://base-pattern-desk.pages.dev" value="${settings.site || ''}" autocapitalize="off" spellcheck="false"></label>
      <label class="field"><span>Relay key (the RELAY_KEY you set on the website)</span><input class="input" id="stRelayKey" type="password" value="${settings.relayKey || ''}" autocapitalize="off" spellcheck="false"></label></div>
      <div class="toolbar"><button class="btn primary" id="stSiteSave">Save and test</button><span class="small" id="stSiteMsg"></span></div>
      ${isDesktop() ? html`<div class="upd-box">
        <h3 style="margin:0">Update the app</h3>
        <p class="small" style="margin:0">The app checks for a new version at start and every 3 hours, from your website above or — without a website — from GitHub, where every new version is published. For GitHub (your repository is private) paste a <b>read-only token</b> once: github.com → Settings → Developer settings → Fine-grained tokens → Generate, repository <i>EmielRepositoryGifthub</i>, permission <i>Contents: Read-only</i>. It is stored only in the app's folder on this Mac and sent only to GitHub.</p>
        <div class="row" style="gap:8px;justify-content:flex-start;flex-wrap:wrap"><input class="input" id="stGh" type="password" placeholder="github_pat_…" style="max-width:320px" autocapitalize="off" spellcheck="false"><button class="btn" id="stGhSave">Save token</button><button class="btn primary" id="stUpd">Update now</button><button class="btn" id="stRestart" hidden>Restart to use the new version</button></div>
      </div>` : ''}
      <p class="muted tiny" style="margin:0" id="stBuild">Version ${VERSION} · build ${__BUILD__}</p>
    </section>
    <section class="card">
      <h2>Buying plan</h2>
      <p class="small" style="margin:0">Equal-size positions bought in a pyramid inside the buy zone: a first buy at the breakout, smaller adds as the stock proves itself, and a stop below the buy point. Used by the Plan button, its alerts and the portfolio checks.</p>
      <form id="stPlan" style="display:grid;gap:10px">
        <div class="grid2"><label class="field"><span>Portfolio value</span><input class="input" name="capital" type="number" min="0" step="any" value="${S.capital}"></label>
        <label class="field"><span>Currency</span><select class="input" name="ccy">${['EUR', 'USD', 'GBP', 'CHF'].map(c => html`<option ${c === S.ccy ? raw('selected') : ''}>${c}</option>`)}</select></label></div>
        <div class="grid2"><label class="field"><span>Position size (% of portfolio)</span><input class="input" name="posPct" type="number" min="1" max="100" step="any" value="${P100(S.posPct)}"></label>
        <label class="field"><span>Stop (%)</span><input class="input" name="stop" type="number" min="1" max="20" step="any" value="${P100(S.stop)}"></label></div>
        <label class="field"><span>Stop measured from</span><select class="input" name="stopFrom"><option value="cost" ${S.stopFrom !== 'pivot' ? raw('selected') : ''}>Your average purchase price (the book: 7–8% below what you paid)</option><option value="pivot" ${S.stopFrom === 'pivot' ? raw('selected') : ''}>The buy point (your webinar notes: 5–8% below the buy point)</option></select></label>
        <div class="grid2"><label class="field"><span>Buys (% of the position, e.g. 50 35 15)</span><input class="input" name="tranches" value="${S.tranches.map(P100).join(' ')}"></label>
        <label class="field"><span>No buys this many days before earnings</span><input class="input" name="earningsDays" type="number" min="0" max="60" value="${S.earningsDays}"></label></div>
        <div class="grid2"><label class="field"><span>Add 2 when this % above the buy point (from–to)</span><input class="input" name="add2" value="${S.add2.map(P100).join(' ')}"></label>
        <label class="field"><span>Add 3 when this % above the buy point (from–to)</span><input class="input" name="add3" value="${S.add3.map(P100).join(' ')}"></label></div>
        <p class="small" id="stPlanEx" style="margin:0"></p>
        <div class="toolbar"><button class="btn primary" type="submit">Save plan settings</button><button class="btn" type="button" id="stPlanReset">Defaults</button></div>
      </form>
    </section>
    <section class="card">
      <h2>O'Neil Coach (AI)</h2>
      <p class="small" style="margin:0">The Coach button answers "what would O'Neil do?" from your playbook and the app's live numbers. Without a key it gives rule-based answers. With your own Anthropic API key it holds full conversations with Claude; the key is stored only on this device and sent only to api.anthropic.com (you pay Anthropic per use, typically a few cents per question at most). Get a key at console.anthropic.com → API keys.</p>
      <div class="grid2"><label class="field"><span>Anthropic API key</span><input class="input" id="stAnth" type="password" placeholder="sk-ant-…" value="${settings.keys.anthropic || ''}" autocapitalize="off" spellcheck="false"></label>
      <label class="field"><span>Model</span><select class="input" id="stAnthModel">${COACH_MODELS.map(([k, l]) => html`<option value="${k}" ${(settings.coachModel || 'claude-opus-5-5') === k ? raw('selected') : ''}>${l}</option>`)}</select></label></div>
      <div class="toolbar"><button class="btn primary" id="stAnthSave">Save</button><span class="small" id="stAnthMsg"></span></div>
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
      <div class="toolbar"><button class="btn" id="stClear">Clear price cache</button><button class="btn" id="stBackup">Back up my data</button><button class="btn" id="stRestore">Restore a backup</button><button class="btn danger" id="stReset">Erase all app data</button></div>
      <p class="muted tiny" style="margin:0">A backup is one file with your settings, watchlists, holdings, buying plans, journal, alerts and drawings. Keep it somewhere safe (or move it to another computer).</p>
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
        <p><b>Base Pattern Desk ${VERSION}</b>: base patterns, market direction, a screener and a portfolio risk review. For personal use.</p>
        <p>Data: Yahoo Finance and Stooq chart feeds (prices), SEC EDGAR (US earnings history), and free news feeds. These public feeds are meant for personal use; check their terms before sharing or selling anything built on them.</p>
        <p><b>Not investment advice.</b> The app applies widely published rules of thumb from classic chart analysis to end-of-day prices for education and research. Signals can be wrong; past patterns don't guarantee future results. Make your own decisions, or talk to a licensed adviser.</p>
        <p>The app is independent and not affiliated with any publisher, research service or data provider. Names of third-party products belong to their owners.</p>
        <p>Charts by <a href="https://www.tradingview.com/" target="_blank" rel="noopener">TradingView</a> Lightweight Charts™ (Apache License 2.0).</p>
      </div>
    </section>`);
  keyBox();
  siteBox(el);
  $('#stAnthSave', el).onclick = async () => {
    settings.keys.anthropic = $('#stAnth', el).value.trim(); settings.coachModel = $('#stAnthModel', el).value; await saveSettings();
    const m = $('#stAnthMsg', el); m.className = 'small t-ok'; m.textContent = settings.keys.anthropic ? 'Saved. The Coach now answers with Claude.' : 'Key removed: the Coach gives offline answers.';
  };
  const ex = () => { const p = pyramid(S, 100); $('#stPlanEx', el).textContent = `Example: ${Math.round(S.capital).toLocaleString('en-US')} ${S.ccy} → ${p.target.toLocaleString('en-US')} ${S.ccy} per position, bought as ${p.steps.map(x => x.amount.toLocaleString('en-US')).join(' + ')} ${S.ccy}; stop ${Math.round(S.stop * 100)}% below ${S.stopFrom === 'pivot' ? 'the buy point' : 'your average purchase price'}, raised to just below the buy point at +15% and to breakeven at +20%.`; };
  ex();
  $('#stPlan', el).onsubmit = async e => {
    e.preventDefault(); const F = new FormData(e.target), nums = v => String(v).split(/[\s,;–-]+/).map(Number).filter(x => isFinite(x) && x >= 0);
    const tr = nums(F.get('tranches')), a2 = nums(F.get('add2')), a3 = nums(F.get('add3'));
    const sum = tr.reduce((a, b) => a + b, 0);
    if (tr.length < 1 || Math.abs(sum - 100) > 0.5) { toast(`The buys should add up to 100% (now ${sum}%).`); return; }
    if (a2.length !== 2 || a3.length !== 2) { toast('Give each add as two numbers, e.g. 1 2.'); return; }
    Object.assign(S, { capital: +F.get('capital'), ccy: F.get('ccy'), posPct: +F.get('posPct') / 100, stop: +F.get('stop') / 100, stopFrom: F.get('stopFrom'), tranches: tr.map(x => x / 100), add2: a2.map(x => x / 100), add3: a3.map(x => x / 100), earningsDays: +F.get('earningsDays') });
    S.zone = Math.max(S.zone || 0.05, S.add3[1]);
    await saveStrategy(S); ex(); toast('Buying plan saved.');
  };
  $('#stPlanReset', el).onclick = async () => { await saveStrategy({}); Object.assign(S, DEFAULT_PLAN); initSettings(el); toast('Back to the defaults.'); };
  $('#stBackup', el).onclick = () => {
    const data = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith('bpd.')) data[k] = localStorage.getItem(k); }
    const blob = new Blob([JSON.stringify({ app: 'Base Pattern Desk', version: VERSION, at: new Date().toISOString(), data }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `base-pattern-desk-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  $('#stRestore', el).onclick = () => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
    inp.onchange = async () => {
      try {
        const j = JSON.parse(await inp.files[0].text());
        if (j.app !== 'Base Pattern Desk' || !j.data) throw new Error('This is not a Base Pattern Desk backup.');
        if (!confirm('Replace your current settings, lists, holdings, plans and journal with this backup from ' + (j.at || '').slice(0, 10) + '?')) return;
        Object.keys(localStorage).filter(k => k.startsWith('bpd.')).forEach(k => localStorage.removeItem(k));
        Object.entries(j.data).forEach(([k, v]) => localStorage.setItem(k, v));
        location.reload();
      } catch (e) { toast(e.message, 5000); }
    };
    inp.click();
  };
  $('#stAuto', el).onchange = async () => { settings.autoScan = +$('#stAuto', el).value; await saveSettings(); toast(settings.autoScan ? `The screener rescans every ${settings.autoScan} minutes.` : 'Automatic scans are off.'); };
  $('#stNotW', el).onchange = async () => { settings.notifyWatch = $('#stNotW', el).checked; await saveSettings(); };
  $('#stSec', el).onchange = async () => { const v = $('#stSec', el).value.trim(); if (v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) { toast('That does not look like an e-mail address.'); return; } settings.secEmail = v; await saveSettings(); toast(v ? 'Saved. SEC requests now include your e-mail.' : 'Removed.'); };
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
  if (p.id === 'free') {
    render(el, html`<p class="small muted" style="margin:0">No key needed. Optional: add a free or paid FMP key as a <b>backup</b>. The app keeps the free data as its main source (worldwide, full history, no daily limit) and asks FMP only for US tickers the free data can't load — for example the factor ETFs in the web version, or when the free feed is down. FMP's free Basic plan allows 250 requests a day and about 5 years of daily prices.</p>
      <label class="field"><span>FMP API key (backup, optional)</span><input class="input" id="stFmpIn" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Paste your FMP key" value="${settings.keys.fmp || ''}"></label>
      <div class="toolbar"><button class="btn" id="stFmpSave">Save and test</button><span class="small" id="stFmpMsg"></span></div>`);
    $('#stFmpSave').onclick = async () => {
      settings.keys.fmp = $('#stFmpIn').value.trim(); await saveSettings();
      const m = $('#stFmpMsg'); if (!settings.keys.fmp) { m.className = 'small muted'; m.textContent = 'Removed.'; return; }
      m.className = 'small muted'; m.textContent = 'Testing…';
      try { const r = await PROVIDERS.fmp.daily('SPY', settings.keys.fmp, Date.now() / 1000 - 60 * 86400); m.className = 'small t-ok'; m.textContent = `Works: SPY loaded from FMP (${r.bars.length} days).`; }
      catch (e) { m.className = 'small t-bad'; m.textContent = e.message; }
    };
    return;
  }
  if (!p.needsKey) { render(el, html`<p class="small muted" style="margin:0">Fictional companies, no internet needed.</p>`); return; }
  render(el, html`<label class="field"><span>${p.name} API key</span><input class="input" id="stKeyIn" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Paste your key" value="${settings.keys[p.id] || ''}"></label>
    <div class="toolbar"><button class="btn primary" id="stSave">Save and test</button><span class="small" id="stMsg"></span></div>`);
  $('#stSave').onclick = async () => {
    settings.keys[p.id] = $('#stKeyIn').value.trim(); await saveSettings();
    const m = $('#stMsg'); m.className = 'small muted'; m.textContent = 'Testing…';
    try { const d = await daily('AAPL', { force: true }); m.className = 'small t-ok'; m.textContent = `Works: AAPL loaded, ${d.bars.length} days of history.`; await switchProvider(); }
    catch (e) { m.className = 'small t-bad'; m.textContent = e.message; }
  };
}

/* your website: data relay for the web/phone version, update source for the desktop app */
function siteBox(el) {
  const msg = $('#stSiteMsg', el), set = (t, c = 'muted') => { msg.className = 'small t-' + c; msg.textContent = t; };
  const status = async () => {
    if (!isDesktop() || !window.desktop.updateStatus) return;
    const u = await window.desktop.updateStatus();
    const st = { off: 'add your website or a GitHub token to get automatic updates', checking: 'checking…', latest: 'up to date', downloading: 'downloading build ' + u.build + '…', ready: 'build ' + u.build + ' downloaded: restart to use it', shell: u.note, error: 'update check failed: ' + u.note, idle: '' }[u.state] || '';
    $('#stBuild', el).textContent = `Version ${VERSION} · running build ${u.running || __BUILD__} · desktop shell ${u.shell}${u.src ? ' · updates from ' + u.src : ''}${st ? ' · ' + st : ''}`;
  };
  status();
  $('#stSiteSave', el).onclick = async () => {
    const site = $('#stSiteUrl', el).value.trim().replace(/\/+$/, ''), key = $('#stRelayKey', el).value.trim();
    if (site && !/^https:\/\/[^\s/]+/.test(site)) { set('The address must start with https://', 'bad'); return; }
    settings.site = site; settings.relayKey = key; await saveSettings(); applySite();
    if (!site) { set('Removed.'); return; }
    set('Testing…');
    try {
      const r = await fetch(site + '/relay?ping=1', { headers: key ? { 'x-relay-key': key } : {} }).then(x => x.json());
      const v = await fetch(site + '/version.json', { cache: 'no-store' }).then(x => x.json()).catch(() => null);
      set(`Website found${v ? ', newest build ' + v.build : ''}. Relay ${r.keyOk ? 'works' : r.keyRequired ? 'needs the right key' : 'works'}${r.keyRequired ? '' : ' (tip: set RELAY_KEY on the website so only you can use it)'}.`, r.keyOk ? 'ok' : 'warn');
      if (isDesktop()) { await window.desktop.checkUpdate(); status(); }
    } catch (e) { set(isDesktop() ? 'Saved. Could not reach the website: check the address.' : 'Saved. The test could not reach the website from this page (it works once you open the app from the website itself).', 'warn'); }
  };
  const u = $('#stUpd', el);
  if (u) u.onclick = async () => {
    u.disabled = true; set('Looking for a new version…');
    const r = await window.desktop.checkUpdate(); await status(); u.disabled = false;
    if (r.state === 'ready') { set('New version ' + r.build + ' downloaded.', 'ok'); $('#stRestart', el).hidden = false; }
    else if (r.state === 'latest') set('You have the newest version.', 'ok');
    else if (r.state === 'off') set('Add your website or a GitHub token first.', 'warn');
    else set(r.note || r.state, r.state === 'error' ? 'bad' : 'warn');
  };
  const rs = $('#stRestart', el); if (rs) rs.onclick = () => window.desktop.restart();
  const gs = $('#stGhSave', el);
  if (gs) {
    if (!window.desktop.setGithubToken) { gs.disabled = true; $('#stGh', el).placeholder = 'needs the newest desktop app download'; }
    gs.onclick = async () => { const t = $('#stGh', el).value.trim(); await window.desktop.setGithubToken(t); $('#stGh', el).value = ''; set(t ? 'Token saved. Press Update now.' : 'Token removed.', 'ok'); };
  }
}

async function switchProvider() { await loadState(); emit('provider'); emit('watch'); }

export function applyTheme(t) {
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  emit('theme');
}
