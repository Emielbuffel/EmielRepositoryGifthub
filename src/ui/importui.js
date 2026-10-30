// Import of broker files: one or more holdings statements (e.g. a DEGIRO Portfolio.csv per month) and account
// statements (DEGIRO Account.csv: deposits, withdrawals, trades, dividends, costs and taxes). Several files can be
// chosen at once; each holdings file becomes a dated snapshot, the newest can become the current holdings and cash.
import { parseStatement, resolveTickers, fileKind, dateFromName, guessDate } from '../core/importer.js';
import { parseAccount, KIND_LABEL } from '../core/ledger.js';
import { fDs } from '../core/analysis.js';
import { snapshotMeta, universe, currencyOf } from '../data/providers.js';
import { secCompanies } from '../data/sec.js';
import { isApp } from '../data/net.js';
import { daily, secAgent } from '../data/service.js';
import { snapshots, addSnapshots, addLedger, ledger, setCash } from '../data/plans.js';
import { App } from '../app.js';
import { $, $$, html, raw, render, money, toast, sheet } from './dom.js';

async function directory() {
  const dir = [];
  try { const meta = await snapshotMeta(); dir.push(...meta.stocks.map(x => [x.s, x.n, '']), ...meta.directory.map(x => [x[0], x[1], x[2]])); } catch (e) { /* none */ }
  try { (await universe()).items.forEach(x => dir.push([x[0], x[1], x[4]])); } catch (e) { /* none */ }
  return dir;
}
async function resolveAll(rows, dir) {
  let out = resolveTickers(rows, dir);
  if (out.some(r => !r.matched) && isApp()) { // US names outside the built-in list: the SEC list of listed companies
    try {
      const sec = (await secCompanies(secAgent())).filter(x => /^(Nasdaq|NYSE)/i.test(x.x)).map(x => [x.s, x.n, '']);
      const again = resolveTickers(out.filter(r => !r.matched), sec); let j = 0;
      out = out.map(r => (r.matched ? r : again[j++]));
    } catch (e) { /* SEC list unavailable */ }
  }
  return out;
}
const ymd = t => new Date(t * 1000).toISOString().slice(0, 10);
const noon = s => Math.floor(Date.parse(s + 'T12:00:00Z') / 1000);
const n0 = x => Math.round(x).toLocaleString('en-US');

/** onDone(newHoldings|null) is called after saving; portfolio.js saves the holdings and re-analyses. */
export function importSheet(onDone, initialFiles) {
  const sh = sheet('Import broker files', html`
    <div class="card" style="gap:10px">
      <p class="small" style="margin:0">Choose one or more CSV files from your broker — you can select several at once:</p>
      <ul class="small" style="margin:0;padding-left:18px"><li><b>Holdings</b> (DEGIRO: Portfolio → Export → CSV). One file per month builds the history; the cash line sets your cash.</li>
      <li><b>Account statement</b> (DEGIRO: Inbox → Account statement → CSV, "Account.csv"): deposits, withdrawals, dividends, dividend tax, costs and taxes.</li></ul>
      <input type="file" id="imFile" multiple accept=".csv,.txt,text/csv,text/plain">
      <textarea class="input" id="imText" rows="3" placeholder="Or paste one table" spellcheck="false"></textarea>
      <div class="toolbar"><button class="btn" id="imRead">Read</button><span class="small" id="imMsg"></span></div>
    </div>
    <div id="imRows" style="display:grid;gap:12px"></div>`);
  const read = async files => {
    const m = $('#imMsg', sh); m.className = 'small muted'; m.textContent = 'Reading…';
    const H = [], A = [], bad = [];
    for (const f of files) {
      try {
        if (fileKind(f.text) === 'account') A.push({ ...f, lines: parseAccount(f.text) });
        else { const st = parseStatement(f.text); H.push({ ...f, st }); }
      } catch (e) { bad.push(`${f.name}: ${e.message}`); }
    }
    // tickers for every holdings file, then the date of each file
    const dir = await directory();
    for (const h of H) h.rows = await resolveAll(h.st.rows, dir);
    const prices = {};
    for (const s of new Set(H.flatMap(h => h.rows.filter(r => r.ticker).map(r => r.ticker)))) { try { prices[s] = (await daily(s)).bars; } catch (e) { /* no prices */ } }
    for (const h of H) {
      const fromName = dateFromName(h.name), g = guessDate(h.rows, prices);
      if (fromName) { h.t = fromName; h.how = 'from the file name'; }
      else if (g) { h.t = g.t + 12 * 3600; h.how = `prices match this day (${g.hits} of ${g.of})`; }
      else { h.t = Math.floor((h.modified || Date.now()) / 1000); h.how = 'file date — please check'; h.check = true; }
    }
    H.sort((a, b) => a.t - b.t);
    const old = await ledger(), have = new Set(old.map(l => l.id));
    m.className = bad.length ? 'small t-warn' : 'small t-ok';
    m.textContent = `${H.length} holdings file${H.length === 1 ? '' : 's'}, ${A.length} account statement${A.length === 1 ? '' : 's'}${bad.length ? ' · skipped: ' + bad.join('; ') : ''}.`;
    const unmatched = [...new Set(H.flatMap(h => h.rows.filter(r => !r.ticker).map(r => r.name || r.isin)))];
    const prevSnaps = await snapshots(), lastPrev = prevSnaps.length ? prevSnaps[prevSnaps.length - 1].t : 0;
    const L = A.flatMap(a => a.lines), newL = L.filter(l => !have.has(l.id));
    const cnt = {}; newL.forEach(l => { cnt[l.kind] = (cnt[l.kind] || 0) + 1; });
    render($('#imRows', sh), html`
      ${H.length ? html`<section class="card" style="gap:8px"><h3 style="margin:0">Holdings files</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>File</th><th>Date of the holdings</th><th class="n">Positions</th><th class="n">Stocks EUR</th><th class="n">Cash</th></tr></thead><tbody>
        ${H.map((h, i) => html`<tr><td class="small" style="max-width:180px;overflow:hidden;text-overflow:ellipsis">${h.name}</td>
          <td><input class="input" type="date" data-hd="${i}" value="${ymd(h.t)}" style="width:150px;padding:5px 8px;font-size:14px"><div class="tiny ${h.check ? 't-warn' : 'muted'}">${h.how}</div></td>
          <td class="n">${h.rows.length}${h.rows.some(r => !r.ticker) ? html`<div class="tiny t-warn">${h.rows.filter(r => !r.ticker).length} without ticker</div>` : ''}</td>
          <td class="n">${n0(h.rows.reduce((s, r) => s + (r.eur || 0), 0))}</td><td class="n">${h.st.cash.length ? money(h.st.cash.reduce((s, x) => s + x.amount, 0), h.st.cash[0].cur) : '—'}</td></tr>`)}
      </tbody></table></div>
      ${unmatched.length ? html`<p class="small" style="margin:0">Tickers not found — fill them in (Yahoo-style, e.g. SNX, ASML.AS), or leave empty: the position is then counted at its statement value without a price history.</p>
        <div style="display:grid;gap:6px">${unmatched.map((n, i) => html`<div class="row"><span class="small" style="min-width:0">${n}</span><input class="input" data-um="${i}" placeholder="Ticker" style="width:120px;padding:5px 8px;font-size:14px" autocapitalize="characters"></div>`)}</div>` : ''}
      <label class="small"><input type="checkbox" id="imCur" ${H[H.length - 1].t >= lastPrev ? raw('checked') : ''}> Use the newest file (<span id="imNewest">${fDs(H[H.length - 1].t)}</span>) as my current holdings and cash</label>
      <p class="muted tiny" style="margin:0">Statements rarely include purchase prices: the average costs you entered are kept. A file with the same date as one imported before replaces it.</p></section>` : ''}
      ${A.length ? html`<section class="card" style="gap:8px"><h3 style="margin:0">Account statement</h3>
        <p class="small" style="margin:0">${fDs(L[0].t)} – ${fDs(L[L.length - 1].t)} · ${L.length} lines, <b>${newL.length} new</b>${L.length - newL.length ? ` (${L.length - newL.length} already imported)` : ''}.</p>
        <div class="kpis">${Object.entries(cnt).sort((a, b) => b[1] - a[1]).map(([k, v]) => html`<div class="kpi"><span class="k">${KIND_LABEL[k] || k}</span><span class="v">${v}</span><span class="s">lines</span></div>`)}</div>
        ${cnt.other ? html`<details><summary class="small t-warn">${cnt.other} lines not recognised (counted nowhere)</summary><ul class="small">${newL.filter(l => l.kind === 'other').slice(0, 30).map(l => html`<li>${fDs(l.t)} · ${l.desc} · ${money(l.amount, l.cur)}</li>`)}</ul></details>` : ''}</section>` : ''}
      ${H.length || A.length ? html`<div class="toolbar"><button class="btn primary" id="imSave">Save</button></div>` : ''}`);
    $$('[data-hd]', sh).forEach(inp => { inp.onchange = () => { H[+inp.dataset.hd].t = noon(inp.value); const z = H.reduce((a, b) => (b.t > a.t ? b : a)); $('#imNewest', sh).textContent = fDs(z.t); }; });
    const save = $('#imSave', sh); if (!save) return;
    save.onclick = async () => {
      const fix = new Map(); $$('[data-um]', sh).forEach(inp => { const v = inp.value.toUpperCase().trim(); if (v) fix.set(unmatched[+inp.dataset.um], v); });
      const useCur = !!($('#imCur', sh) && $('#imCur', sh).checked);
      const snaps = H.map(h => {
        const cash = h.st.cash.reduce((s, x) => s + x.amount, 0);
        return { t: h.t, file: h.name, cash, cashCur: h.st.cash.length ? h.st.cash[0].cur : 'EUR', rows: h.rows.map(r => { const sym = r.ticker || fix.get(r.name || r.isin) || ''; return { sym, name: r.name, isin: r.isin, shares: r.qty, price: r.price, cur: r.cur || (sym ? currencyOf(sym) : ''), eur: r.eur }; }) };
      });
      if (snaps.length) await addSnapshots(snaps);
      const added = L.length ? await addLedger(L) : 0;
      let hold = null;
      if (useCur && snaps.length) {
        const z = snaps.reduce((a, b) => (b.t > a.t ? b : a));
        hold = z.rows.filter(r => r.sym).map(r => { const h = App.holdings.find(x => x.sym === r.sym); return { sym: r.sym, shares: r.shares, cost: (h && h.cost) || null }; });
        if (H.find(h => h.name === z.file).st.cash.length) await setCash(z.cash, z.cashCur, z.t);
      }
      sh.close(); onDone(hold);
      toast([snaps.length ? `${snaps.length} holdings file${snaps.length > 1 ? 's' : ''} saved` : '', L.length ? `${added} new account lines` : '', hold ? 'current holdings updated' : ''].filter(Boolean).join(' · ') + '.', 4500);
    };
  };
  if (initialFiles && initialFiles.length) read(initialFiles);
  $('#imFile', sh).onchange = async e => { const fs = [...e.target.files]; if (fs.length) read(await Promise.all(fs.map(async f => ({ name: f.name, modified: f.lastModified, text: await f.text() })))); };
  $('#imRead', sh).onclick = () => { const t = $('#imText', sh).value; if (t.trim()) read([{ name: 'Pasted table', modified: Date.now(), text: t }]); };
}
