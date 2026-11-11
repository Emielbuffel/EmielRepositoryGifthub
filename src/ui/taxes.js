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
import { realisedGains, CGT } from '../core/cgt.js';
import { loadTrades, refValues, setOwnRef } from './trades.js';

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
    <section class="card" id="txCgt"></section>
    <p class="disclaimer">An overview of what your statements show, to help with your tax return. It is not tax advice: rules, rates and exemptions change every year — check them with the FOD Financiën / SPF Finances or your accountant.</p>`);
  const inp = $('#txFile'), drop = $('#txDrop');
  inp.onchange = () => { if (inp.files.length) read([...inp.files]); inp.value = ''; };
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); const f = [...e.dataTransfer.files].filter(f => /\.(pdf|csv)$/i.test(f.name)); if (f.length) read(f); };
  on(type => { if ((type === 'cash' || type === 'view' || type === 'journal') && App.view === 'taxes') { overview(); cgtCard(); } });
  overview(); cgtCard();
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

/* ---------- capital gains (Belgian 10% tax from 2026) ---------- */
async function cgtCard() {
  const el = $('#txCgt'); if (!el) return;
  const S = await strategy(), base = S.ccy || 'EUR';
  const { trades, src, fx } = await loadTrades(base);
  if (!trades.length) { render(el, html`<div class="card-head"><h2>Capital gains (10% tax from 2026)</h2></div><p class="muted small" style="margin:0">Upload DEGIRO statements with your buys and sells (above), or record trades in the buying plans, to see your realised gains per year and the estimated tax.</p>`); return; }
  render(el, html`<div class="card-head"><h2>Capital gains (10% tax from 2026)</h2></div><p class="small muted" style="margin:0"><span class="spinner"></span> Working out your realised gains…</p>`);
  // stocks that need the 31-12-2025 value: bought before 2026, or sold without a purchase in the data
  const names = {}; trades.forEach(x => { names[x.key] = x.name; });
  const pre = new Set(trades.filter(x => x.side === 'buy' && x.t < CGT.start).map(x => x.key));
  const sold26 = new Set(trades.filter(x => x.side === 'sell' && x.t >= CGT.start).map(x => x.key));
  const need = [...sold26].filter(k => pre.has(k) || !trades.some(x => x.key === k && x.side === 'buy' && x.t < trades.find(y => y.key === k && y.side === 'sell' && y.t >= CGT.start).t));
  const refs = await refValues(need, names, base, fx);
  const R = realisedGains(trades, k => refs[k] ? refs[k].v : null);
  const years = Object.keys(R.years).sort().reverse();
  const sales = R.sales.filter(x => x.taxed).sort((a, b) => b.t - a.t);
  const m = x => x == null ? '—' : big(x, base);
  render(el, html`
    <div class="card-head"><h2>Capital gains (10% tax from 2026)</h2><span class="muted tiny">From your ${src === 'statement' ? 'DEGIRO statements' : 'buying-plan trades'}</span></div>
    ${years.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Year</th><th class="n">Gains</th><th class="n">Losses</th><th class="n">Net</th><th class="n">Exempt</th><th class="n">Taxable</th><th class="n">Tax 10%</th></tr></thead><tbody>
      ${years.map(y => { const v = R.years[y]; return html`<tr><td><b>${y}</b>${v.unknown ? html`<div class="t-warn tiny">${v.unknown} sale${v.unknown > 1 ? 's' : ''} without a purchase price</div>` : ''}</td><td class="n up">${m(v.gains)}</td><td class="n down">${m(v.losses)}</td><td class="n">${m(v.net)}</td><td class="n">${m(v.exemption)}</td><td class="n">${m(v.taxable)}</td><td class="n"><b>${m(v.tax)}</b></td></tr>`; })}
    </tbody></table></div>` : html`<p class="small" style="margin:0">No sales from 2026 on yet: nothing to tax so far.</p>`}
    ${sales.length ? html`<details ${sales.length <= 12 ? raw('open') : ''}><summary><b>Sales from 2026</b> <span class="muted small">${sales.length}</span></summary>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Stock</th><th class="n">Shares</th><th class="n">Sold for</th><th class="n">Cost basis</th><th class="n">Gain</th></tr></thead><tbody>
      ${sales.map(x => html`<tr><td class="small">${fDs(x.t)}</td><td class="small">${x.name}<div class="muted tiny">${x.parts.map(p => p.how).join('; ')}</div></td><td class="n">${+x.qty.toFixed(4)}</td><td class="n">${m(x.proceeds)}</td><td class="n">${m(x.basis)}</td><td class="n ${x.gain >= 0 ? 'up' : 'down'}">${m(x.gain)}</td></tr>`)}
      </tbody></table></div></details>` : ''}
    ${need.length ? html`<details><summary><b>Values on 31 December 2025</b> <span class="muted small">${need.length} stock${need.length > 1 ? 's' : ''} bought before 2026</span></summary>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Stock</th><th class="n">Value per share (${base})</th><th>Source</th></tr></thead><tbody>
      ${need.map(k => html`<tr><td class="small">${names[k]}<div class="muted tiny">${k}</div></td><td class="n"><input class="input sm-select" style="width:110px;text-align:right" type="number" step="any" min="0" data-ref="${k}" value="${refs[k] ? +refs[k].v.toFixed(4) : ''}" placeholder="enter"></td><td class="small muted">${!refs[k] ? 'not found: enter the closing price of 31-12-2025' : refs[k].src === 'own' ? 'your number' : `closing price ${refs[k].close} ${refs[k].cur} (${refs[k].src})`}</td></tr>`)}
      </tbody></table></div><p class="muted tiny" style="margin:0">Keep proof of these values (e.g. DEGIRO's portfolio overview of 31-12-2025): as a client of a foreign broker you document them yourself.</p></details>` : ''}
    <ul class="small muted" style="margin:0">
      <li>Rules used: 10% on the net gains of a year above the exemption (EUR ${CGT.exemption[2026].toLocaleString('en-US')} in 2026; indexed in later years). Shares bought before 2026 start from their closing price on 31-12-2025, or — for sales up to and including 2030 — your real average purchase price when that is higher. Several purchases: the average purchase price. Losses of the year offset gains of the year. Costs and TOB are not deducted here.</li>
      <li>DEGIRO is a foreign broker and does not withhold this tax: you declare the gains in your tax return. An estimate to help with that, not tax advice — check the final rules with the FOD Financiën or your accountant.</li>
    </ul>`);
  $$('[data-ref]', el).forEach(i => { i.onchange = async () => { await setOwnRef(i.dataset.ref, i.value === '' ? null : +i.value); cgtCard(); }; });
}
