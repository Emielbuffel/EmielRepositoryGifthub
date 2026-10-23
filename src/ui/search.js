// Search sheet: finds stocks through the chosen provider, or loads any typed ticker.
import { provider, settings, isDemo } from '../data/service.js';
import { DEMO } from '../data/providers.js';
import { openStock } from '../app.js';
import { $, $$, html, render, sheet } from './dom.js';

export function openSearch() {
  const sh = sheet('Search', html`
    <input class="input" id="qIn" type="search" placeholder="${isDemo() ? 'Demo company or ticker, e.g. Acme' : 'Company or ticker: Apple, ASML.AS, 7203.T, 005930.KS'}" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="Search stocks">
    <div class="results" id="qRes"></div>
    <p class="muted tiny" style="margin:0">${isDemo() ? 'Demo mode shows fictional companies. Choose a data provider in Settings for real stocks.' : 'Tickers use Yahoo-style suffixes: .L London (pence), .DE Xetra, .PA Paris, .AS Amsterdam, .SW Swiss, .T Tokyo, .HK Hong Kong, .KS Korea. Coverage depends on your data plan.'}</p>`);
  const inp = $('#qIn', sh), res = $('#qRes', sh);
  let timer = null, seq = 0, items = [], act = 0;
  const show = (list, msg) => {
    items = list; act = 0;
    render(res, html`${msg ? html`<div class="muted small" style="padding:10px 14px">${msg}</div>` : ''}${list.map((x, i) => html`<button data-i="${i}" class="${i === 0 ? 'act' : ''}"><span class="s">${x.symbol}</span><span class="n">${x.name || ''}</span><span class="x">${x.exchange || ''}${x.currency ? ' · ' + x.currency : ''}</span></button>`)}`);
    $$('button', res).forEach(b => { b.onclick = () => pick(+b.dataset.i); });
  };
  const pick = i => { const x = items[i]; if (!x) return; sh.close(); openStock(x.symbol, x.name); };
  const own = t => /^[A-Z0-9^][A-Z0-9.\-]{0,14}$/.test(t) ? [{ symbol: t, name: 'Open this ticker', exchange: '' }] : [];
  const run = async term => {
    const s = ++seq, T = term.toUpperCase().replace(/\s+/g, '');
    try {
      const r = await provider().search(term, settings.keys[settings.provider]);
      if (s !== seq) return;
      const list = r.slice(0, 12); if (!isDemo() && !list.some(x => x.symbol === T)) list.push(...own(T));
      show(list, list.length ? '' : 'No matches.');
    } catch (e) { if (s === seq) show(isDemo() ? [] : own(T), e.message); }
  };
  inp.oninput = () => {
    clearTimeout(timer); const t = inp.value.trim();
    if (!t) { show(isDemo() ? DEMO.map(d => ({ symbol: d.sym, name: d.name, exchange: 'Demo' })) : []); return; }
    timer = setTimeout(() => run(t), isDemo() ? 50 : 400);
  };
  inp.onkeydown = e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!items.length) return; act = (act + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; $$('button', res).forEach((b, i) => b.classList.toggle('act', i === act)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (items.length) pick(act); else if (inp.value.trim() && !isDemo()) { sh.close(); openStock(inp.value.trim()); } }
  };
  inp.oninput();
  setTimeout(() => inp.focus(), 60);
}
