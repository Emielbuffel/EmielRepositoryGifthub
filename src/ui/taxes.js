// The "Dividends & taxes" tab: upload DEGIRO statements (PDF or CSV), check how each line was read, save them, and see
// dividends, withholding tax, the Belgian stock-exchange tax (TOB), costs and margin interest per year, per stock and
// per country of the company — the figures you need for your tax return.
import { ledgerFromRows, isinCountry } from '../core/pdfledger.js';
import { parseAccount, summarize, KIND_LABEL } from '../core/ledger.js';
import { ledger, addLedger, strategy } from '../data/plans.js';
import { fxLookup, monthChart } from './account.js';
import { on, App } from '../app.js';
import { $, $$, html, raw, render, money, toast, ICON, tok } from './dom.js';
const big = (x, cur) => (x < 0 ? '−' : '') + money(Math.abs(x || 0), cur); // cents matter for a tax return
import { fDs } from '../core/analysis.js';

const T = { pending: null, year: null };
const KINDS = ['dividend', 'divtax', 'tax', 'fee', 'interest', 'deposit', 'withdrawal', 'buy', 'sell', 'internal', 'other'];
const COUNTRY = { US: 'United States', NL: 'Netherlands', BE: 'Belgium', DE: 'Germany', FR: 'France', GB: 'United Kingdom', IE: 'Ireland', LU: 'Luxembourg', CH: 'Switzerland', DK: 'Denmark', SE: 'Sweden', NO: 'Norway', FI: 'Finland', ES: 'Spain', IT: 'Italy', PT: 'Portugal', AT: 'Austria', JP: 'Japan', KR: 'South Korea', HK: 'Hong Kong', KY: 'Cayman Islands', CA: 'Canada', AU: 'Australia', TW: 'Taiwan', IL: 'Israel', BM: 'Bermuda', JE: 'Jersey', CN: 'China', IN: 'India', SG: 'Singapore' };

export async function initTaxes(el) {
  render(el, html`
    <section class="card">
      <div class="card-head"><h2>Upload DEGIRO statements</h2><span class="muted tiny">PDF or CSV · several files at once</span></div>
      <label class="drop" id="txDrop">${raw(ICON.plus || '')}<span><b>Choose or drop your DEGIRO account statements</b><br><span class="small muted">DEGIRO → Inbox → Account statement (Rekeningoverzicht / Relevé de compte) → choose the period (e.g. a whole year) → download as PDF, or CSV.</span></span><input type="file" id="txFile" accept=".pdf,.csv,application/pdf,text/csv" multiple hidden></label>
      <p class="muted tiny" style="margin:0">The files are read on this device only. Lines already saved are recognised and not counted twice, so overlapping periods are fine.</p>
    </section>
    <section class="card" id="txReview" hidden></section>
    <section class="card" id="txSum"></section>
    <section class="card" id="txStocks" hidden></section>
    <section class="card" id="txList" hidden></section>
    <p class="disclaimer">An overview of what your statements show, to help with your tax return. It is not tax advice: rules, rates and exemptions change every year — check them with the FOD Financiën / SPF Finances or your accountant.</p>`);
  const inp = $('#txFile'), drop = $('#txDrop');
  inp.onchange = () => { if (inp.files.length) read([...inp.files]); inp.value = ''; };
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); const f = [...e.dataTransfer.files].filter(f => /\.(pdf|csv)$/i.test(f.name)); if (f.length) read(f); };
  on(type => { if ((type === 'cash' || type === 'view') && App.view === 'taxes') overview(); });
  overview();
}

/** Reads the chosen files and shows what was found, for checking before saving. */
async function read(files) {
  const box = $('#txReview'); box.hidden = false;
  render(box, html`<p class="small" style="margin:0"><span class="spinner"></span> Reading ${files.length} file${files.length > 1 ? 's' : ''}…</p>`);
  const have = new Set((await ledger()).map(l => l.id)), found = [], notes = [];
  for (const f of files) {
    try {
      let lines;
      if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') {
        const { pdfLines } = await import('../data/pdftext.js'), r = await pdfLines(f);
        lines = ledgerFromRows(r.lines);
        if (!lines.length) notes.push(`${f.name}: no statement lines found (${r.pages} page${r.pages > 1 ? 's' : ''}). Is it the account statement? A scanned PDF (an image) cannot be read.`);
      } else lines = parseAccount(await f.text());
      const fresh = lines.filter(l => !have.has(l.id));
      notes.push(`${f.name}: ${lines.length} lines${lines.length - fresh.length ? `, ${lines.length - fresh.length} already saved` : ''}.`);
      fresh.forEach(l => { have.add(l.id); found.push(l); });
    } catch (e) { notes.push(`${f.name}: ${e.message}`); }
  }
  T.pending = found.sort((a, b) => a.t - b.t);
  review(notes);
}

function review(notes) {
  const box = $('#txReview'), L = T.pending || [];
  const count = k => L.filter(l => l.kind === k).length;
  render(box, html`
    <div class="card-head"><h2>Check before saving</h2><span class="muted tiny">${L.length} new line${L.length === 1 ? '' : 's'}</span></div>
    <ul class="small" style="margin:0">${notes.map(n => html`<li>${n}</li>`)}</ul>
    ${L.length ? html`
      <p class="small" style="margin:0">${['dividend', 'divtax', 'tax', 'fee', 'interest'].map(k => html`<span class="tag t-mute" style="margin-right:4px">${KIND_LABEL[k]} ${count(k)}</span>`)}${L.filter(l => l.sub === 'tob').length ? html`<span class="tag t-mute">of which stock-exchange tax (TOB) ${L.filter(l => l.sub === 'tob').length}</span>` : ''}${count('other') ? html` <span class="tag t-warn">not recognised ${count('other')}</span>` : ''}</p>
      <div class="tbl-wrap" style="max-height:420px;overflow:auto"><table class="tbl"><thead><tr><th>Date</th><th>Product</th><th>Description</th><th class="n">Amount</th><th>Read as</th></tr></thead><tbody>
        ${L.map((l, i) => html`<tr class="${l.kind === 'other' ? 'warn-row' : ''}"><td class="small">${fDs(l.t)}</td><td class="small">${l.product || '—'}${l.isin ? html`<div class="muted tiny">${l.isin}</div>` : ''}</td><td class="small">${l.desc}</td><td class="n ${l.amount >= 0 ? 'up' : 'down'}">${l.cur} ${l.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
          <td><select class="input sm-select" data-i="${i}">${KINDS.map(k => html`<option value="${k}" ${l.kind === k && !(k === 'tax' && l.sub === 'tob') ? raw('selected') : ''}>${KIND_LABEL[k]}</option>`)}<option value="tob" ${l.sub === 'tob' ? raw('selected') : ''}>Stock-exchange tax (TOB)</option></select></td></tr>`)}
      </tbody></table></div>
      <div class="toolbar"><button class="btn primary" id="txSave">Save ${L.length} lines</button><button class="btn" id="txCancel">Cancel</button><span class="muted tiny">Change "Read as" where needed. Buys, sells, deposits and withdrawals also feed the Portfolio tab's account history.</span></div>` : html`<div class="toolbar"><button class="btn" id="txCancel">Close</button></div>`}`);
  $$('select[data-i]', box).forEach(s => { s.onchange = () => { const l = T.pending[+s.dataset.i]; if (s.value === 'tob') { l.kind = 'tax'; l.sub = 'tob'; } else { l.kind = s.value; delete l.sub; } }; });
  const sv = $('#txSave'); if (sv) sv.onclick = async () => { const n = await addLedger(T.pending); T.pending = null; box.hidden = true; toast(`${n} lines saved.`); overview(); };
  $('#txCancel').onclick = () => { T.pending = null; box.hidden = true; };
}

/** Dividends, withholding tax, TOB, costs and interest: per year, per stock and per country. */
async function overview() {
  const Lg = await ledger(), el = $('#txSum'); if (!el) return;
  if (!Lg.length) { render(el, html`<div class="empty">${raw(ICON.info)}<p>No statements yet. Upload your DEGIRO account statements above: the app then shows your dividends, the tax withheld on them, the stock-exchange tax (TOB), costs and margin interest per year, per stock and per country.</p></div>`); $('#txStocks').hidden = true; $('#txList').hidden = true; return; }
  const S = await strategy(), base = S.ccy || 'EUR', fx = await fxLookup(Lg.map(l => l.cur), base);
  const years = [...new Set(Lg.map(l => new Date(l.t * 1000).getUTCFullYear()))].sort((a, b) => b - a);
  if (T.year == null || (T.year !== 'all' && !years.includes(T.year))) T.year = years[0];
  const from = T.year === 'all' ? 0 : Date.UTC(T.year, 0, 1) / 1000, to = T.year === 'all' ? Infinity : Date.UTC(T.year + 1, 0, 1) / 1000 - 1;
  const sum = summarize(Lg, fx, from, to), t = sum.tot, all = summarize(Lg, fx);
  const tobOf = (a, b) => Lg.filter(l => l.sub === 'tob' && l.t >= a && l.t <= b).reduce((s, l) => s + l.amount * fx(l.cur, l.t), 0);
  const tob = tobOf(from, to), otherTax = t.tax - tob;
  const kp = (k, v, sub, cls = '') => html`<div class="kpi"><span class="k">${k}</span><span class="v ${cls}">${v}</span><span class="s">${sub}</span></div>`;
  render(el, html`
    <div class="card-head"><h2>Dividends &amp; taxes</h2><div class="chips">${years.map(y => html`<button class="chip${T.year === y ? ' on' : ''}" data-y="${y}">${y}</button>`)}<button class="chip${T.year === 'all' ? ' on' : ''}" data-y="all">All</button></div></div>
    <div class="kpis">
      ${kp('Dividends (gross)', big(t.dividend, base), 'before any tax', 'up')}
      ${kp('Dividend tax withheld', big(t.divtax, base), t.dividend ? Math.round(-t.divtax / t.dividend * 100) + '% of the gross' : '')}
      ${kp('Net dividends', big(t.dividend + t.divtax, base), 'paid into your account')}
      ${kp('Stock-exchange tax (TOB)', big(tob, base), 'on your buys and sells', tob < 0 ? 'down' : '')}
      ${otherTax ? kp('Other taxes', big(otherTax, base), 'e.g. foreign transaction taxes', 'down') : ''}
      ${kp('Costs', big(t.fee, base), 'transaction costs and connection fees', 'down')}
      ${t.interest ? kp(t.interest < 0 ? 'Margin interest paid' : 'Interest received', big(t.interest, base), t.interest < 0 ? 'the cost of your margin loan' : '', t.interest < 0 ? 'down' : 'up') : ''}
    </div>
    <div class="tbl-wrap">${raw(monthChart(sum.months, base))}</div>
    <div class="legend small">${[[tok('--up'), 'Dividends (gross)'], [tok('--pink'), 'Dividend tax'], [tok('--orange'), 'Costs'], [tok('--red'), 'Taxes (incl. TOB)']].map(([c, s]) => html`<span><i style="background:${c};height:10px;width:10px;border-radius:3px"></i>${s}</span>`)}</div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Year</th><th class="n">Dividends</th><th class="n">Div. tax</th><th class="n">Net</th><th class="n">TOB</th><th class="n">Costs</th><th class="n">Interest</th></tr></thead><tbody>
      ${[...all.years].reverse().map(([y, v]) => { const yt = tobOf(Date.UTC(+y, 0, 1) / 1000, Date.UTC(+y + 1, 0, 1) / 1000 - 1); return html`<tr><td><b>${y}</b></td><td class="n up">${big(v.dividend, base)}</td><td class="n">${big(v.divtax, base)}</td><td class="n">${big(v.dividend + v.divtax, base)}</td><td class="n">${big(yt, base)}</td><td class="n down">${big(v.fee, base)}</td><td class="n">${big(v.interest, base)}</td></tr>`; })}
    </tbody></table></div>
    <p class="muted tiny" style="margin:0">From ${Lg.length} saved statement lines (${fDs(Lg[0].t)} – ${fDs(Lg[Lg.length - 1].t)}). Other currencies are converted to ${base} at the rate of their week.</p>`);
  $$('[data-y]', el).forEach(b => { b.onclick = () => { T.year = b.dataset.y === 'all' ? 'all' : +b.dataset.y; overview(); }; });
  // per stock and per country of the company (from the ISIN), for the tax return
  const per = new Map();
  for (const l of Lg) {
    if (l.t < from || l.t > to || (l.kind !== 'dividend' && l.kind !== 'divtax')) continue;
    const k = l.isin || l.product || '?'; if (!per.has(k)) per.set(k, { name: l.product || l.isin || '?', isin: l.isin, c: isinCountry(l.isin), gross: 0, tax: 0 });
    per.get(k)[l.kind === 'dividend' ? 'gross' : 'tax'] += l.amount * fx(l.cur, l.t);
  }
  const rows = [...per.values()].sort((a, b) => b.gross - a.gross), byC = new Map();
  rows.forEach(r => { const c = r.c || '?'; if (!byC.has(c)) byC.set(c, { c, gross: 0, tax: 0, n: 0 }); const x = byC.get(c); x.gross += r.gross; x.tax += r.tax; x.n++; });
  const st = $('#txStocks'); st.hidden = !rows.length;
  if (rows.length) render(st, html`
    <div class="card-head"><h2>Dividends per country and per stock</h2><span class="muted tiny">${T.year === 'all' ? 'all years' : T.year}</span></div>
    <div class="grid2">
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Country of the company</th><th class="n">Gross</th><th class="n">Withheld</th><th class="n">Rate</th></tr></thead><tbody>
        ${[...byC.values()].sort((a, b) => b.gross - a.gross).map(x => html`<tr><td>${COUNTRY[x.c] || x.c} <span class="muted tiny">${x.n} stock${x.n > 1 ? 's' : ''}</span></td><td class="n">${big(x.gross, base)}</td><td class="n">${big(x.tax, base)}</td><td class="n">${x.gross ? Math.round(-x.tax / x.gross * 100) + '%' : '—'}</td></tr>`)}
      </tbody></table><p class="muted tiny" style="margin:4px 0 0">The country comes from the first two letters of the ISIN. Foreign dividends and the tax already withheld abroad are what a Belgian tax return asks about; when no Belgian withholding tax was taken (a foreign broker such as DEGIRO normally doesn't), the dividends generally have to be declared yourself.</p></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Stock</th><th class="n">Gross</th><th class="n">Tax</th><th class="n">Net</th></tr></thead><tbody>
        ${rows.slice(0, 40).map(x => html`<tr><td class="small">${x.name}<div class="muted tiny">${x.isin || ''}</div></td><td class="n">${big(x.gross, base)}</td><td class="n">${big(x.tax, base)}</td><td class="n">${big(x.gross + x.tax, base)}</td></tr>`)}
      </tbody></table></div>
    </div>`);
  // every tax and cost line of the period, to check against the statements
  const ls = Lg.filter(l => l.t >= from && l.t <= to && ['divtax', 'tax', 'fee', 'interest'].includes(l.kind)).sort((a, b) => b.t - a.t), lt = $('#txList');
  lt.hidden = !ls.length;
  if (ls.length) render(lt, html`<details><summary><b>All tax, cost and interest lines</b> <span class="muted small">${ls.length} in ${T.year === 'all' ? 'all years' : T.year}</span></summary>
    <div class="tbl-wrap" style="max-height:360px;overflow:auto"><table class="tbl"><thead><tr><th>Date</th><th>What</th><th>Product</th><th class="n">Amount</th></tr></thead><tbody>
      ${ls.slice(0, 600).map(l => html`<tr><td class="small">${fDs(l.t)}</td><td class="small">${l.sub === 'tob' ? 'Stock-exchange tax (TOB)' : KIND_LABEL[l.kind]}<div class="muted tiny">${l.desc}</div></td><td class="small">${l.product || '—'}</td><td class="n down">${l.cur} ${l.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td></tr>`)}
    </tbody></table></div></details>`);
}
