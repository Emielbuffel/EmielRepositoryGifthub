import { Vault } from './vault.js';
import { initialState, migrate, mergeStates, ACCOUNT_TYPES, OWNERS, PALETTE, ownerName } from './model.js';
import { categorize, merchantKey } from './categorize.js';
import {
  uid, nowIso, todayStr, monthKey, addMonths, lastMonths, monthLabel, formatDate, money, money0, pct,
  escapeHtml as h, normalize, round2, debounce, sum, groupBy, setLocale,
} from './util.js';
import * as I from './insights.js';
import * as Charts from './charts.js';

const vault = new Vault();
let state = null;
const ui = {
  page: 'dashboard',
  month: monthKey(todayStr()),
  txFilter: { q: '', month: 'all', account: 'all', category: 'all', type: 'all' },
  importRows: [],
  importInfo: null,
  projection: null,
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const app = $('#app');

// ------------------------------------------------------------- persistence --
const persist = debounce(async () => {
  try {
    await vault.save(state);
  } catch (e) {
    toast('Could not save: ' + e.message, 'error');
  }
}, 300);

function commit(rerender = true) {
  persist();
  if (rerender) render();
}

function markDeleted(id) {
  state.deleted[id] = nowIso();
}

// ------------------------------------------------------------------ helpers --
const cat = (id) => state.categories.find((c) => c.id === id) || { id, name: 'Unknown', icon: '❔', kind: 'expense' };
const acc = (id) => state.accounts.find((a) => a.id === id) || { id, name: 'Unknown account', color: '#888', type: 'checking', owner: 'joint' };
const amt = (v, cls = '') => `<span class="amt ${cls}">${money(v)}</span>`;

function signedAmt(t) {
  if (t.type === 'income') return `<span class="amt pos">+${money(t.amount)}</span>`;
  if (t.type === 'transfer') return `<span class="amt muted">${money(t.amount)}</span>`;
  return `<span class="amt neg">−${money(t.amount)}</span>`;
}

function toast(msg, kind = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, 3500);
}

function categoryOptions(selected, kind) {
  const groups = [['expense', 'Expenses'], ['income', 'Income'], ['transfer', 'Transfers (not counted)']];
  return groups
    .filter(([k]) => !kind || k === kind)
    .map(([k, label]) => `<optgroup label="${label}">${state.categories.filter((c) => c.kind === k).map((c) => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${c.icon} ${h(c.name)}</option>`).join('')}</optgroup>`)
    .join('');
}

function accountOptions(selected) {
  return state.accounts.map((a) => `<option value="${a.id}" ${a.id === selected ? 'selected' : ''}>${h(a.name)}</option>`).join('');
}

function ownerOptions(selected) {
  return Object.keys(OWNERS).map((o) => `<option value="${o}" ${o === selected ? 'selected' : ''}>${h(ownerName(state, o))}</option>`).join('');
}

const EMBEDDED = (() => { try { return window.self !== window.top; } catch { return true; } })();

/** Inside an embedded page downloads are blocked, so offer the text to copy instead. */
function copyOut(title, text, hint) {
  const m = openModal(title, `<p class="muted small">${hint}</p><textarea id="copy-out" rows="8" readonly>${h(text)}</textarea>
    <div class="actions"><span class="grow"></span><button class="btn" data-close>Close</button><button class="btn primary" id="copy-btn">Copy</button></div>`);
  const ta = m.querySelector('#copy-out');
  m.querySelector('#copy-btn').onclick = () => {
    navigator.clipboard.writeText(text).then(() => toast('Copied', 'ok')).catch(() => { ta.focus(); ta.select(); toast('Select all and copy'); });
  };
}

function download(filename, content, type) {
  if (EMBEDDED && typeof content === 'string') {
    return copyOut(filename, content, 'Downloads are blocked on this page. Copy the text below and paste it into a note or a file (e.g. in the Notes or Files app).');
  }
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const file = new File([blob], filename, { type });
  if (navigator.canShare && navigator.canShare({ files: [file] }) && /iPhone|iPad/.test(navigator.userAgent)) {
    navigator.share({ files: [file], title: filename }).catch(() => {});
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// -------------------------------------------------------------------- modal --
function openModal(title, bodyHtml, { onMount, wide = false } = {}) {
  closeModal();
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${h(title)}">
    <div class="modal-head"><h2>${h(title)}</h2><button class="icon-btn" data-close aria-label="Close">✕</button></div>
    <div class="modal-body">${bodyHtml}</div></div>`;
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap || e.target.closest('[data-close]')) closeModal();
  });
  document.body.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add('show'));
  onMount && onMount(wrap);
  const first = wrap.querySelector('input:not([type=hidden]),select,textarea');
  if (first && window.matchMedia('(pointer: fine)').matches) first.focus();
  return wrap;
}

function closeModal() {
  $$('.modal-backdrop').forEach((m) => m.remove());
}

function confirmBox(message, okLabel = 'Delete', danger = true) {
  return new Promise((resolve) => {
    const m = openModal('Please confirm', `<p>${message}</p><div class="actions"><button class="btn" data-close>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" id="cf-ok">${h(okLabel)}</button></div>`);
    m.querySelector('#cf-ok').onclick = () => { closeModal(); resolve(true); };
    m.addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target === m) resolve(false); });
  });
}

function askText(title, label, type = 'password') {
  return new Promise((resolve) => {
    const m = openModal(title, `<form id="ask-form"><label>${h(label)}<input id="ask-in" type="${type}" autocomplete="off" required></label><div class="actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">OK</button></div></form>`);
    m.querySelector('#ask-form').onsubmit = (e) => { e.preventDefault(); const v = m.querySelector('#ask-in').value; closeModal(); resolve(v); };
    m.addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target === m) resolve(null); });
  });
}

// ------------------------------------------------------------- lock screen --
async function showLock() {
  document.body.classList.add('locked');
  const exists = await vault.exists();
  app.innerHTML = `
  <div class="lock">
    <div class="lock-card">
      <div class="logo">${logoSvg()}</div>
      <h1>Cashflow Compass</h1>
      ${exists ? `
        <p class="muted">Your data is encrypted on this device. Enter your passcode to unlock.</p>
        <form id="unlock-form">
          <input id="pass" type="password" inputmode="text" autocomplete="current-password" placeholder="Passcode" required>
          <button class="btn primary block" id="unlock-btn">Unlock</button>
          <p class="error" id="lock-err" hidden></p>
        </form>
        <button class="link small" id="forgot">Forgot passcode?</button>` : `
        <p class="muted">Track income and expenses for your household, privately. Choose a passcode – it encrypts everything stored on this device. <strong>There is no way to recover it</strong>, so keep it safe and make regular backups.</p>
        <form id="setup-form">
          <input id="pass1" type="password" autocomplete="new-password" placeholder="New passcode (min. 6 characters)" minlength="6" required>
          <input id="pass2" type="password" autocomplete="new-password" placeholder="Repeat passcode" minlength="6" required>
          <button class="btn primary block">Create my private vault</button>
          <p class="error" id="lock-err" hidden></p>
        </form>
        <button class="link small" id="restore">Restore from a backup file instead</button>`}
      <p class="tiny muted">🔒 No account, no cloud, no tracking. Data never leaves this device unless you export a backup.</p>
    </div>
  </div>`;

  const err = (m) => { const e = $('#lock-err'); e.textContent = m; e.hidden = !m; };
  if (exists) {
    $('#unlock-form').onsubmit = async (e) => {
      e.preventDefault();
      const btn = $('#unlock-btn');
      btn.disabled = true;
      btn.textContent = 'Unlocking…';
      try {
        state = migrate(await vault.unlock($('#pass').value));
        start();
      } catch {
        err('Wrong passcode.');
        btn.disabled = false;
        btn.textContent = 'Unlock';
        $('#pass').select();
      }
    };
    $('#forgot').onclick = async () => {
      if (await confirmBox('Without the passcode the data cannot be decrypted. You can erase everything and start again (or restore a backup if you remember its passcode).', 'Erase all data')) {
        await vault.wipe();
        showLock();
      }
    };
    setTimeout(() => $('#pass')?.focus(), 50);
  } else {
    $('#setup-form').onsubmit = async (e) => {
      e.preventDefault();
      const p1 = $('#pass1').value;
      if (p1 !== $('#pass2').value) return err('The passcodes do not match.');
      if (p1.length < 6) return err('Use at least 6 characters.');
      state = initialState();
      await vault.create(p1, state);
      start(true);
    };
    $('#restore').onclick = () => restoreBackup(true);
  }
}

// --------------------------------------------------------------- app start --
let idleTimer = null;
let lastActive = Date.now();

function start(firstRun = false) {
  document.body.classList.remove('locked');
  setLocale(state.settings.locale, state.settings.currency);
  I.setMoneyFormatter(money0);
  applyTheme();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  ['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach((ev) => window.addEventListener(ev, () => (lastActive = Date.now()), { passive: true }));
  clearInterval(idleTimer);
  idleTimer = setInterval(checkIdle, 15000);
  document.addEventListener('visibilitychange', checkIdle);
  ui.month = I.latestMonth(state);
  const hash = location.hash.replace('#', '');
  if (hash && PAGES[hash]) ui.page = hash;
  render();
  if (firstRun) {
    go('plan');
    toast('Welcome! Start by entering your incomes, then your account balances.');
  }
}

function checkIdle() {
  if (!state) return;
  const limit = (state.settings.autoLockMin || 5) * 60000;
  if (Date.now() - lastActive > limit) lockNow();
}

async function lockNow() {
  await vault.save(state).catch(() => {});
  state = null;
  vault.lock();
  // a full reload wipes every decrypted value from memory
  location.hash = '';
  location.reload();
}

function applyTheme() {
  const t = state?.settings.theme || 'auto';
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

// -------------------------------------------------------------------- shell --
const svg = (d) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONS = {
  dashboard: svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  transactions: svg('<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>'),
  import: svg('<path d="M12 15V3M7 8l5-5 5 5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>'),
  insights: svg('<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>'),
  accounts: svg('<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>'),
  plan: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>'),
  settings: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  more: svg('<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'),
  lock: svg('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  eye: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: svg('<path d="M3 3l18 18M10.6 5.1A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a10 10 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'),
};
const NAV = [
  ['dashboard', 'Overview', ICONS.dashboard],
  ['transactions', 'Transactions', ICONS.transactions],
  ['import', 'Import', ICONS.import],
  ['insights', 'Save & invest', ICONS.insights],
  ['accounts', 'Accounts', ICONS.accounts],
  ['plan', 'Income & budgets', ICONS.plan],
  ['settings', 'Settings', ICONS.settings],
];
const MOBILE_NAV = ['dashboard', 'transactions', 'import', 'insights', 'more'];

function go(page) {
  if (page === 'more') return openMore();
  ui.page = page;
  history.replaceState(null, '', '#' + page);
  closeModal();
  render();
  window.scrollTo(0, 0);
}

function openMore() {
  openModal('More', `<div class="more-list">${NAV.filter(([id]) => !MOBILE_NAV.includes(id)).map(([id, label, ic]) => `<button class="more-item" data-go="${id}"><span class="nav-ic">${ic}</span>${label}</button>`).join('')}
    <button class="more-item" id="more-lock"><span class="nav-ic">${ICONS.lock}</span>Lock now</button></div>`, {
    onMount: (m) => {
      m.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => go(b.dataset.go)));
      m.querySelector('#more-lock').onclick = lockNow;
    },
  });
}

function shell(content) {
  const hidden = document.body.classList.contains('hide-amounts');
  return `
  <aside class="sidebar">
    <div class="brand">${logoSvg()}<span>Cashflow Compass</span></div>
    <nav>${NAV.map(([id, label, ic]) => `<button class="nav-item ${ui.page === id ? 'active' : ''}" data-go="${id}"><span class="nav-ic">${ic}</span>${label}</button>`).join('')}</nav>
    <div class="sidebar-foot">
      <button class="nav-item" id="toggle-hide"><span class="nav-ic">${hidden ? ICONS.eye : ICONS.eyeOff}</span>${hidden ? 'Show amounts' : 'Hide amounts'}</button>
      <button class="nav-item" id="lock-btn"><span class="nav-ic">${ICONS.lock}</span>Lock</button>
    </div>
  </aside>
  <div class="main-wrap">
    <header class="topbar">
      <h1>${NAV.find(([id]) => id === ui.page)?.[1] || ''}</h1>
      <div class="top-actions">
        <button class="icon-btn" id="toggle-hide-m" title="${hidden ? 'Show' : 'Hide'} amounts" aria-label="${hidden ? 'Show' : 'Hide'} amounts">${hidden ? ICONS.eyeOff : ICONS.eye}</button>
        <button class="btn primary small" id="quick-add">+ Add</button>
        <button class="icon-btn mobile-only" id="lock-btn-m" title="Lock" aria-label="Lock">${ICONS.lock}</button>
      </div>
    </header>
    <main id="main">${content}</main>
  </div>
  <nav class="tabbar">${MOBILE_NAV.map((id) => {
    const n = NAV.find(([x]) => x === id) || ['more', 'More', ICONS.more];
    const active = ui.page === id || (id === 'more' && !MOBILE_NAV.includes(ui.page));
    return `<button class="tab ${active ? 'active' : ''} ${id === 'import' ? 'tab-center' : ''}" data-go="${id}"><span class="tab-ic">${n[2]}</span><span>${id === 'insights' ? 'Save' : n[1].split(' ')[0]}</span></button>`;
  }).join('')}</nav>`;
}

const PAGES = {
  dashboard: renderDashboard,
  transactions: renderTransactions,
  import: renderImport,
  insights: renderInsights,
  accounts: renderAccounts,
  plan: renderPlan,
  settings: renderSettings,
};

function render() {
  if (!state) return;
  Charts.destroyCharts();
  const page = PAGES[ui.page] || renderDashboard;
  const { html, mount } = page();
  app.innerHTML = shell(html);
  $$('[data-go]').forEach((b) => (b.onclick = () => go(b.dataset.go)));
  $('#lock-btn').onclick = lockNow;
  $('#lock-btn-m').onclick = lockNow;
  $('#quick-add').onclick = () => editTransaction();
  const toggle = () => { document.body.classList.toggle('hide-amounts'); render(); };
  $('#toggle-hide').onclick = toggle;
  $('#toggle-hide-m').onclick = toggle;
  mount && mount();
}

// ---------------------------------------------------------------- dashboard --
function renderDashboard() {
  const m = ui.month;
  const months12 = lastMonths(m, 12);
  const series = I.monthlySeries(state, months12);
  const cur = series[series.length - 1];
  const prev = series[series.length - 2];
  const nw = I.netWorth(state);
  const hasData = state.transactions.length > 0;
  const cats = I.expensesByCategory(state, [m]);
  const top = cats.slice(0, 8);
  const rest = sum(cats.slice(8), (x) => x.total);
  const byAcc = I.expensesByAccount(state, [m]);
  const sugg = I.buildSuggestions(state).filter((s) => s.level !== 'info').slice(0, 3);
  const pending = pendingRecurring(m);
  const recent = [...state.transactions].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 6);
  const delta = (a, b, inverse = false) => {
    if (!b) return '';
    const d = (a - b) / b;
    if (!isFinite(d) || Math.abs(d) < 0.005) return '<span class="delta">= vs last month</span>';
    const good = inverse ? d < 0 : d > 0;
    return `<span class="delta ${good ? 'good' : 'bad'}">${d > 0 ? '▲' : '▼'} ${Math.abs(d * 100).toFixed(0)}% vs last month</span>`;
  };
  const backupDays = state.settings.lastBackupAt ? Math.floor((Date.now() - new Date(state.settings.lastBackupAt)) / 86400000) : null;

  const html = `
  <div class="month-bar">
    <button class="icon-btn" id="m-prev" aria-label="Previous month">‹</button>
    <strong>${monthLabel(m, true)}</strong>
    <button class="icon-btn" id="m-next" aria-label="Next month">›</button>
  </div>
  ${!hasData ? `<div class="card empty-hero"><h2>Let's get started</h2><p>1. Enter your incomes (you, your partner, rental) and fixed costs under <a href="#plan" data-go="plan">Income &amp; budgets</a>.<br>2. Enter the current balance of each account under <a href="#accounts" data-go="accounts">Accounts</a>.<br>3. <a href="#import" data-go="import">Import</a> screenshots, PDF statements or CSV exports – or add expenses by hand.</p></div>` : ''}
  ${pending.length ? `<div class="banner"><span>🔁 ${pending.length} recurring item(s) not yet added for ${monthLabel(m, true)} (${pending.map((r) => h(r.name)).join(', ')}).</span><button class="btn small primary" id="post-rec">Add them</button></div>` : ''}
  ${backupDays === null && hasData ? `<div class="banner warn"><span>💾 You have no backup yet. Data lives only on this device.</span><button class="btn small" data-go="settings">Back up</button></div>` : backupDays > 30 ? `<div class="banner warn"><span>💾 Last backup ${backupDays} days ago.</span><button class="btn small" data-go="settings">Back up</button></div>` : ''}
  <section class="kpis">
    <div class="kpi"><span class="kpi-label">Income</span><span class="kpi-value pos-ink">${amt(cur.income)}</span>${delta(cur.income, prev.income)}</div>
    <div class="kpi"><span class="kpi-label">Expenses</span><span class="kpi-value">${amt(cur.expenses)}</span>${delta(cur.expenses, prev.expenses, true)}</div>
    <div class="kpi"><span class="kpi-label">Saved</span><span class="kpi-value ${cur.net < 0 ? 'neg-ink' : ''}">${amt(cur.net)}</span><span class="delta">${isFinite(cur.rate) ? `${pct(cur.rate)} of income · target ${state.settings.savingsTargetPct}%` : '—'}</span></div>
    <div class="kpi"><span class="kpi-label">Net worth</span><span class="kpi-value">${amt(nw)}</span><span class="delta">${state.accounts.filter((a) => a.balanceDate).length}/${state.accounts.length} balances entered</span></div>
  </section>
  ${isFinite(cur.rate) ? `<div class="card slim"><div class="progress-label"><span>Savings rate this month</span><span>${pct(cur.rate)} / ${state.settings.savingsTargetPct}%</span></div><div class="progress"><div class="bar ${cur.rate >= state.settings.savingsTargetPct / 100 ? 'ok' : cur.rate < 0 ? 'bad' : 'mid'}" style="width:${Math.max(0, Math.min(100, (cur.rate * 100) / Math.max(1, state.settings.savingsTargetPct) * 100))}%"></div></div></div>` : ''}
  <section class="grid-2">
    <div class="card"><h3>Income vs expenses <small>last 12 months</small></h3><div class="chart"><canvas id="c-ie"></canvas></div></div>
    <div class="card"><h3>Saved per month</h3><div class="chart"><canvas id="c-net"></canvas></div></div>
    <div class="card"><h3>Where the money went <small>${monthLabel(m, true)}</small></h3>${top.length ? `<div class="chart" style="height:${Math.max(160, (top.length + (rest ? 1 : 0)) * 32 + 30)}px"><canvas id="c-cat"></canvas></div>` : '<p class="muted">No expenses this month yet.</p>'}</div>
    <div class="card"><h3>Income sources</h3><div class="chart"><canvas id="c-src"></canvas></div></div>
  </section>
  <section class="grid-2">
    <div class="card"><h3>Spending per account <small>${monthLabel(m)}</small></h3>
      ${state.accounts.map((a) => { const v = byAcc.get(a.id) || 0; const max = Math.max(1, ...byAcc.values()); return `<div class="acc-row"><span class="dot" style="background:${a.color}"></span><span class="grow">${h(a.name)}</span>${amt(v)}</div><div class="progress thin"><div class="bar" style="width:${(v / max) * 100}%;background:${a.color}"></div></div>`; }).join('')}
    </div>
    <div class="card"><h3>Top suggestions</h3>${sugg.length ? sugg.map(suggestionHtml).join('') : '<p class="muted">Nothing urgent. See <a href="#insights" data-go="insights">Save &amp; invest</a> for ideas.</p>'}
      <button class="link" data-go="insights">All suggestions →</button></div>
  </section>
  <div class="card"><h3>Latest transactions</h3>${recent.length ? txListHtml(recent) : '<p class="muted">No transactions yet.</p>'}<button class="link" data-go="transactions">All transactions →</button></div>`;

  const mount = () => {
    $('#m-prev').onclick = () => { ui.month = addMonths(ui.month, -1); render(); };
    $('#m-next').onclick = () => { ui.month = addMonths(ui.month, 1); render(); };
    $('#post-rec') && ($('#post-rec').onclick = () => postRecurring(m));
    bindTxList();
    const labels = months12.map((x) => monthLabel(x));
    Charts.incomeExpenseChart($('#c-ie'), labels, series.map((x) => round2(x.income)), series.map((x) => round2(x.expenses)));
    Charts.netChart($('#c-net'), labels, series.map((x) => round2(x.net)), series.map((x) => x.rate));
    if (top.length) {
      const narrow = window.innerWidth < 600;
      const l = top.map((x) => {
        const n = cat(x.categoryId).name.replace(/\s*\(.*\)/, '');
        return `${cat(x.categoryId).icon} ${narrow && n.length > 15 ? n.slice(0, 14) + '…' : n}`;
      });
      const v = top.map((x) => round2(x.total));
      if (rest) { l.push('Other categories'); v.push(round2(rest)); }
      Charts.categoryBars($('#c-cat'), l, v);
    }
    const src = I.incomeBySource(state, months12);
    Charts.incomeSourcesChart($('#c-src'), labels, [
      { label: state.settings.meName || 'Me', data: src.map((x) => round2(x.me)) },
      { label: state.settings.partnerName || 'Partner', data: src.map((x) => round2(x.partner)) },
      { label: 'Rental', data: src.map((x) => round2(x.rental)) },
      { label: 'Other', data: src.map((x) => round2(x.other)) },
    ]);
  };
  return { html, mount };
}

function suggestionHtml(s) {
  return `<div class="sugg ${s.level}"><div class="sugg-ic">${s.icon}</div><div class="sugg-body"><strong>${h(s.title)}</strong><p>${h(s.text)}</p>
    ${s.saving > 1 ? `<span class="chip">Potential: ${money0(s.saving)}/month · ${money0(s.saving * 12)}/year</span>` : ''}
    ${s.source ? `<a class="src" href="${s.source.url}" target="_blank" rel="noopener noreferrer">Source: ${h(s.source.label)} ↗</a>` : ''}</div></div>`;
}

// ------------------------------------------------------------ transactions --
function txListHtml(list) {
  const byDate = groupBy(list, (t) => t.date);
  return `<div class="tx-list">${[...byDate.entries()].map(([d, txs]) => `
    <div class="tx-day">${formatDate(d)}</div>
    ${txs.map((t) => { const c = cat(t.categoryId); const a = acc(t.accountId); return `
      <button class="tx" data-tx="${t.id}">
        <span class="tx-ic">${c.icon}</span>
        <span class="tx-main"><span class="tx-desc">${h(t.description)}</span><span class="tx-meta"><span class="dot" style="background:${a.color}"></span>${h(a.name)} · ${h(c.name)}${t.owner && t.type === 'income' ? ' · ' + h(ownerName(state, t.owner)) : ''}${t.note ? ' · 📝' : ''}</span></span>
        ${signedAmt(t)}
      </button>`; }).join('')}`).join('')}</div>`;
}

function bindTxList() {
  $$('[data-tx]').forEach((b) => (b.onclick = () => editTransaction(state.transactions.find((t) => t.id === b.dataset.tx))));
}

function filteredTx() {
  const f = ui.txFilter;
  const q = normalize(f.q);
  return state.transactions
    .filter((t) => (f.month === 'all' || monthKey(t.date) === f.month) && (f.account === 'all' || t.accountId === f.account) && (f.category === 'all' || t.categoryId === f.category) && (f.type === 'all' || t.type === f.type) && (!q || normalize(t.description + ' ' + (t.note || '')).includes(q)))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

function renderTransactions() {
  const f = ui.txFilter;
  const months = [...new Set(state.transactions.map((t) => monthKey(t.date)))].sort().reverse();
  const list = filteredTx();
  const inc = sum(list.filter((t) => t.type === 'income'), (t) => t.amount);
  const exp = sum(list.filter((t) => t.type === 'expense'), (t) => t.amount);
  const shown = list.slice(0, 400);
  const html = `
  <div class="filters card slim">
    <input id="f-q" type="search" placeholder="Search description or note…" value="${h(f.q)}">
    <select id="f-month"><option value="all">All months</option>${months.map((m) => `<option value="${m}" ${f.month === m ? 'selected' : ''}>${monthLabel(m, true)}</option>`).join('')}</select>
    <select id="f-acc"><option value="all">All accounts</option>${accountOptions(f.account)}</select>
    <select id="f-cat"><option value="all">All categories</option>${categoryOptions(f.category)}</select>
    <select id="f-type"><option value="all">All types</option>${['expense', 'income', 'transfer'].map((t) => `<option value="${t}" ${f.type === t ? 'selected' : ''}>${t[0].toUpperCase() + t.slice(1)}</option>`).join('')}</select>
  </div>
  <div class="summary-row"><span>${list.length} transaction(s)</span><span>In ${amt(inc, 'pos')}</span><span>Out ${amt(exp, 'neg')}</span><span>Net ${amt(inc - exp)}</span>
    <span class="grow"></span><button class="btn small" id="exp-csv">Export CSV</button></div>
  <div class="card">${shown.length ? txListHtml(shown) : '<p class="muted">No transactions match.</p>'}${list.length > shown.length ? `<p class="muted small">Showing the first ${shown.length}. Use the filters to narrow down.</p>` : ''}</div>`;
  const mount = () => {
    const upd = (k, sel) => ($(sel).onchange = (e) => { f[k] = e.target.value; render(); });
    upd('month', '#f-month'); upd('account', '#f-acc'); upd('category', '#f-cat'); upd('type', '#f-type');
    $('#f-q').oninput = debounce((e) => { f.q = e.target.value; const pos = e.target.selectionStart; render(); const el = $('#f-q'); el.focus(); el.setSelectionRange(pos, pos); }, 250);
    $('#exp-csv').onclick = () => exportCsv(list);
    bindTxList();
  };
  return { html, mount };
}

function exportCsv(list) {
  const rows = [['Date', 'Description', 'Type', 'Category', 'Account', 'Owner', 'Amount', 'Note']];
  for (const t of list) rows.push([t.date, t.description, t.type, cat(t.categoryId).name, acc(t.accountId).name, ownerName(state, t.owner), (t.type === 'expense' ? -t.amount : t.amount).toFixed(2), t.note || '']);
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
  download(`cashflow-transactions-${todayStr()}.csv`, '﻿' + csv, 'text/csv');
}

function editTransaction(tx) {
  const isNew = !tx;
  const t = tx ? { ...tx } : { id: uid(), date: todayStr(), description: '', amount: '', type: 'expense', categoryId: 'groceries', accountId: state.accounts[0]?.id, owner: state.accounts[0]?.owner || 'joint', note: '', source: 'manual' };
  const body = `
  <form id="tx-form" class="form">
    <div class="seg" role="radiogroup">${['expense', 'income', 'transfer'].map((k) => `<label class="seg-item"><input type="radio" name="type" value="${k}" ${t.type === k ? 'checked' : ''}><span>${k === 'expense' ? '− Expense' : k === 'income' ? '+ Income' : '⇄ Transfer'}</span></label>`).join('')}</div>
    <label>Amount (€)<input name="amount" type="text" inputmode="decimal" placeholder="0,00" value="${t.amount === '' ? '' : String(t.amount).replace('.', ',')}" required></label>
    <label>Description<input name="description" type="text" placeholder="e.g. Colruyt, Salary, Rent" value="${h(t.description)}" required list="desc-suggest" autocomplete="off"></label>
    <datalist id="desc-suggest">${[...new Set(state.transactions.slice(-300).map((x) => x.description))].slice(0, 100).map((d) => `<option value="${h(d)}">`).join('')}</datalist>
    <div class="row2">
      <label>Date<input name="date" type="date" value="${t.date}" required></label>
      <label>${'From / to account'}<select name="accountId">${accountOptions(t.accountId)}</select></label>
    </div>
    <div class="row2">
      <label>Category<select name="categoryId">${categoryOptions(t.categoryId)}</select></label>
      <label>Person<select name="owner">${ownerOptions(t.owner || 'joint')}</select></label>
    </div>
    <label>Note (optional)<input name="note" type="text" value="${h(t.note || '')}"></label>
    <label class="check"><input type="checkbox" name="learn" ${isNew ? '' : 'checked'}> Remember this category for “${h(merchantKey(t.description) || 'this merchant')}”</label>
    <div class="actions">
      ${isNew ? '' : '<button type="button" class="btn danger" id="tx-del">Delete</button>'}
      <span class="grow"></span>
      <button type="button" class="btn" data-close>Cancel</button>
      <button class="btn primary">${isNew ? 'Add' : 'Save'}</button>
    </div>
  </form>`;
  openModal(isNew ? 'Add transaction' : 'Edit transaction', body, {
    onMount: (m) => {
      const form = m.querySelector('#tx-form');
      let touchedCat = !isNew;
      form.categoryId.onchange = () => (touchedCat = true);
      const syncType = () => {
        const type = form.type.value;
        const c = cat(form.categoryId.value);
        if (c.kind !== type) form.categoryId.value = type === 'income' ? 'salary' : type === 'transfer' ? 'transfer' : 'other-exp';
      };
      $$('input[name=type]', form).forEach((r) => (r.onchange = syncType));
      form.accountId.onchange = () => { form.owner.value = acc(form.accountId.value).owner || 'joint'; };
      form.description.addEventListener('change', () => {
        if (touchedCat) return;
        const r = categorize(form.description.value, state.rules, { accountType: acc(form.accountId.value).type, sign: form.type.value === 'income' ? 1 : -1 });
        if (r.matched) { form.type.value = r.type; form.categoryId.value = r.categoryId; }
      });
      m.querySelector('#tx-del')?.addEventListener('click', async () => {
        if (!(await confirmBox(`Delete “${h(t.description)}”?`))) return;
        state.transactions = state.transactions.filter((x) => x.id !== t.id);
        markDeleted(t.id);
        closeModal();
        commit();
        toast('Transaction deleted');
      });
      form.onsubmit = (e) => {
        e.preventDefault();
        const amount = parseFloat(String(form.amount.value).replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
        if (!isFinite(amount) || amount <= 0) return toast('Enter a positive amount', 'error');
        const out = { ...t, type: form.type.value, amount: round2(amount), description: form.description.value.trim(), date: form.date.value, accountId: form.accountId.value, categoryId: form.categoryId.value, owner: form.owner.value, note: form.note.value.trim(), updatedAt: nowIso() };
        if (cat(out.categoryId).kind !== out.type) out.type = cat(out.categoryId).kind;
        if (isNew) { out.createdAt = nowIso(); state.transactions.push(out); }
        else state.transactions = state.transactions.map((x) => (x.id === out.id ? out : x));
        if (form.learn.checked) learnRule(out.description, out.categoryId, out.type);
        closeModal();
        commit();
        toast(isNew ? 'Transaction added' : 'Saved');
      };
    },
  });
}

function learnRule(description, categoryId, type) {
  const key = merchantKey(description);
  if (!key || key.length < 3) return;
  const auto = categorize(description, [], {});
  const existing = state.rules.find((r) => r.pattern === key);
  if (existing) { existing.categoryId = categoryId; existing.type = type; existing.updatedAt = nowIso(); return; }
  if (auto.categoryId === categoryId) return; // built-in rules already get it right
  state.rules.push({ id: uid(), pattern: key, categoryId, type, updatedAt: nowIso() });
}

// ------------------------------------------------------------------- import --
function renderImport() {
  const rows = ui.importRows;
  const info = ui.importInfo;
  const defaultAcc = info?.accountId || 'beobank';
  const html = `
  <div class="card">
    <h3>1. Which account are these from?</h3>
    <p class="muted small">Pick the account first: it is used for every imported line (you can still change single lines). Credit card lines without a sign are treated as expenses.</p>
    <select id="imp-acc">${accountOptions(state.accounts.some((a) => a.id === defaultAcc) ? defaultAcc : state.accounts[0]?.id)}</select>
    <h3>2. Add files</h3>
    <label class="dropzone" id="dropzone">
      <input type="file" id="imp-files" multiple accept="image/*,.pdf,application/pdf,.csv,text/csv,.txt">
      <span class="dz-ic">⇪</span>
      <strong>Drop screenshots, PDF statements or CSV exports here</strong>
      <span class="muted small">or tap to choose · PNG/JPG, PDF, CSV · Dutch &amp; English text is recognised on this device</span>
    </label>
    <div id="imp-progress" hidden><div class="progress"><div class="bar ok" id="imp-bar" style="width:0%"></div></div><p class="muted small" id="imp-status"></p></div>
    <details class="tips"><summary>Tips for the best results</summary>
      <ul>
        <li><strong>CSV exports are the most accurate</strong> – Belfius, KBC and Beobank online banking let you download your transactions as CSV.</li>
        <li>For screenshots: one list of transactions per screenshot, zoomed so the text is sharp. Dark mode is fine.</li>
        <li>PDF statements with selectable text are read directly; scanned PDFs are OCR'd (slower).</li>
        <li>Paying your Beobank card from Belfius/KBC is recognised as a <em>transfer</em>, so card purchases are not counted twice.</li>
        <li>Lines that look like a transaction you already have are unticked as <span class="chip warn">possible duplicate</span>.</li>
      </ul>
    </details>
  </div>
  ${rows.length ? `
  <div class="card">
    <div class="review-head"><h3>3. Review ${rows.length} line(s)</h3>
      <div class="review-actions"><button class="btn small" id="sel-all">Select all</button><button class="btn small" id="sel-none">Select none</button><button class="btn small" id="imp-clear">Discard</button></div></div>
    ${info?.balance != null ? `<div class="banner"><span>Detected balance <strong>${amt(info.balance)}</strong> on the screenshot.</span><button class="btn small" id="use-bal">Set as ${h(acc(info.accountId).name)} balance</button></div>` : ''}
    <div class="review">
      ${rows.map((r, i) => `
      <div class="rv ${r.include ? '' : 'off'}" data-i="${i}">
        <input type="checkbox" class="rv-inc" ${r.include ? 'checked' : ''} aria-label="Include">
        <input type="date" class="rv-date" value="${r.date || ''}">
        <input type="text" class="rv-desc" value="${h(r.description)}">
        <div class="rv-amt"><select class="rv-type"><option value="expense" ${r.type === 'expense' ? 'selected' : ''}>−</option><option value="income" ${r.type === 'income' ? 'selected' : ''}>+</option><option value="transfer" ${r.type === 'transfer' ? 'selected' : ''}>⇄</option></select><input type="text" inputmode="decimal" class="rv-amount" value="${String(r.amount).replace('.', ',')}"></div>
        <select class="rv-cat">${categoryOptions(r.categoryId)}</select>
        <select class="rv-acc">${accountOptions(r.accountId)}</select>
        ${r.duplicate ? '<span class="chip warn">possible duplicate</span>' : ''}
      </div>`).join('')}
    </div>
    <div class="actions"><span class="muted small" id="imp-sum"></span><span class="grow"></span><button class="btn primary" id="imp-save">Save selected</button></div>
    ${info?.texts?.length ? `<details class="tips"><summary>Show recognised text</summary><pre class="ocr">${h(info.texts.join('\n\n——\n\n'))}</pre></details>` : ''}
  </div>` : ''}
  <div class="card"><h3>Paste text instead</h3><p class="muted small">You can also copy text from your banking website and paste it here.</p>
    <textarea id="paste" rows="4" placeholder="04/11/2026  Colruyt Halle  -86,45"></textarea><button class="btn" id="paste-go">Read pasted text</button></div>`;

  const mount = () => {
    const input = $('#imp-files');
    const dz = $('#dropzone');
    input.onchange = () => handleFiles([...input.files]);
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('over'));
    dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('over'); handleFiles([...e.dataTransfer.files]); });
    $('#imp-acc').onchange = (e) => { ui.importInfo = { ...(ui.importInfo || {}), accountId: e.target.value }; };
    $('#paste-go').onclick = async () => {
      const { parseText } = await import('./parser.js');
      const accountId = $('#imp-acc').value;
      const r = parseText($('#paste').value, { accountType: acc(accountId).type });
      addCandidates(r.items, accountId, r.balance, [$('#paste').value]);
    };
    if (!rows.length) return;
    const sync = () => {
      const sel = ui.importRows.filter((r) => r.include);
      $('#imp-sum').innerHTML = `${sel.length} selected · out ${money(sum(sel.filter((r) => r.type === 'expense'), (r) => r.amount))} · in ${money(sum(sel.filter((r) => r.type === 'income'), (r) => r.amount))}`;
    };
    $$('.rv').forEach((el) => {
      const r = ui.importRows[+el.dataset.i];
      el.querySelector('.rv-inc').onchange = (e) => { r.include = e.target.checked; el.classList.toggle('off', !r.include); sync(); };
      el.querySelector('.rv-date').onchange = (e) => (r.date = e.target.value);
      el.querySelector('.rv-desc').onchange = (e) => (r.description = e.target.value);
      el.querySelector('.rv-amount').onchange = (e) => { const v = parseFloat(e.target.value.replace(/\./g, '').replace(',', '.')); if (isFinite(v)) r.amount = Math.abs(v); sync(); };
      el.querySelector('.rv-type').onchange = (e) => {
        r.type = e.target.value;
        if (cat(r.categoryId).kind !== r.type) { r.categoryId = r.type === 'income' ? 'other-inc' : r.type === 'transfer' ? 'transfer' : 'other-exp'; el.querySelector('.rv-cat').value = r.categoryId; }
        sync();
      };
      el.querySelector('.rv-cat').onchange = (e) => { r.categoryId = e.target.value; r.type = cat(r.categoryId).kind; el.querySelector('.rv-type').value = r.type; r.userSetCat = true; sync(); };
      el.querySelector('.rv-acc').onchange = (e) => (r.accountId = e.target.value);
    });
    $('#sel-all').onclick = () => { ui.importRows.forEach((r) => (r.include = true)); render(); };
    $('#sel-none').onclick = () => { ui.importRows.forEach((r) => (r.include = false)); render(); };
    $('#imp-clear').onclick = () => { ui.importRows = []; ui.importInfo = { accountId: ui.importInfo?.accountId }; render(); };
    $('#use-bal') && ($('#use-bal').onclick = () => { setBalance(info.accountId, info.balance, todayStr()); ui.importInfo.balance = null; commit(); toast('Balance updated'); });
    $('#imp-save').onclick = saveImport;
    sync();
  };
  return { html, mount };
}

async function handleFiles(files) {
  if (!files.length) return;
  const accountId = $('#imp-acc').value;
  const account = acc(accountId);
  const { importFile } = await import('./importers.js');
  const prog = $('#imp-progress');
  const bar = $('#imp-bar');
  const status = $('#imp-status');
  prog.hidden = false;
  const all = [];
  const texts = [];
  let balance = null;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    status.textContent = `Reading ${f.name} (${i + 1}/${files.length})… The first OCR run loads the text-recognition engine – this can take a few seconds.`;
    try {
      const r = await importFile(f, {
        accountType: account.type,
        onProgress: (p) => (bar.style.width = `${((i + p) / files.length) * 100}%`),
        askPassword: (msg) => prompt(msg),
      });
      all.push(...r.items);
      if (r.text) texts.push(`[${f.name}]\n${r.text.slice(0, 5000)}`);
      if (r.balance != null && balance == null) balance = r.balance;
    } catch (e) {
      console.error(e);
      toast(e.message || `Could not read ${f.name}`, 'error');
    }
    bar.style.width = `${((i + 1) / files.length) * 100}%`;
  }
  status.textContent = all.length ? `Found ${all.length} line(s).` : 'No transactions found. Check the recognised text below, or try a sharper screenshot / CSV export.';
  addCandidates(all, accountId, balance, texts);
}

function addCandidates(items, accountId, balance, texts) {
  const account = acc(accountId);
  const existing = state.transactions;
  const rows = items.map((it) => {
    const r = categorize(it.description, state.rules, { accountType: account.type, sign: it.sign });
    let type = r.type;
    if (type !== 'transfer') type = it.sign > 0 ? 'income' : 'expense';
    let categoryId = cat(r.categoryId).kind === type ? r.categoryId : type === 'income' ? 'other-inc' : 'other-exp';
    const date = it.date || todayStr();
    const dup = existing.some((t) => Math.abs(t.amount - it.amount) < 0.005 && Math.abs(new Date(t.date) - new Date(date)) <= 3 * 86400000 && (t.accountId === accountId || t.source === 'recurring'))
      || ui.importRows.some((t) => Math.abs(t.amount - it.amount) < 0.005 && t.date === date && normalize(t.description) === normalize(it.description));
    return { description: it.description, amount: round2(it.amount), date, type, categoryId, accountId, include: !dup, duplicate: dup, autoCat: categoryId };
  });
  ui.importRows = [...ui.importRows, ...rows];
  ui.importInfo = { accountId, balance: balance ?? ui.importInfo?.balance ?? null, texts: [...(ui.importInfo?.texts || []), ...(texts || [])] };
  render();
  if (rows.length) setTimeout(() => $('.review')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
}

function saveImport() {
  const sel = ui.importRows.filter((r) => r.include && r.amount > 0);
  const t = nowIso();
  for (const r of sel) {
    state.transactions.push({ id: uid(), date: r.date || todayStr(), description: r.description.trim() || 'Unknown', amount: round2(r.amount), type: r.type, categoryId: r.categoryId, accountId: r.accountId, owner: acc(r.accountId).owner || 'joint', note: '', source: 'import', createdAt: t, updatedAt: t });
    if (r.userSetCat && r.categoryId !== r.autoCat) learnRule(r.description, r.categoryId, r.type);
  }
  const count = sel.length;
  const accountId = ui.importInfo?.accountId;
  ui.importRows = [];
  ui.importInfo = { accountId };
  const months = [...new Set(sel.map((r) => monthKey(r.date)))].sort();
  if (months.length) ui.month = months[months.length - 1];
  commit(false);
  import('./importers.js').then((m) => m.releaseOcr());
  toast(`${count} transaction(s) saved`, 'ok');
  go('dashboard');
}

// ----------------------------------------------------------------- insights --
function renderInsights() {
  const sugg = I.buildSuggestions(state);
  const potential = sum(sugg, (s) => s.saving || 0);
  const recent = I.completeMonths(state, 3);
  const months = recent.length ? recent : [I.latestMonth(state)];
  const series = I.monthlySeries(state, months);
  const avgInc = sum(series, (x) => x.income) / series.length;
  const avgExp = sum(series, (x) => x.expenses) / series.length;
  const surplus = Math.max(0, avgInc - avgExp);
  const p = ui.projection || { monthly: Math.round(surplus / 10) * 10 || 500, years: 20, rate: state.settings.expectedReturnPct };
  ui.projection = p;
  const proj = I.projectInvesting(p.monthly, p.years, p.rate);
  const last = proj[proj.length - 1] || { value: 0, invested: 0 };
  const liquid = I.liquidBalance(state);
  const emergency = avgExp * state.settings.emergencyMonths;
  const lm = I.latestMonth(state);
  const prev3 = lastMonths(addMonths(lm, -1), 3);
  const nowC = new Map(I.expensesByCategory(state, [lm]).map((x) => [x.categoryId, x.total]));
  const avgC = I.avgByCategory(state, prev3);
  const prevN = I.monthsWithData(state, prev3).length;
  const catIds = [...new Set([...nowC.keys(), ...avgC.keys()])].sort((a, b) => (nowC.get(b) || 0) - (nowC.get(a) || 0));
  const essential = sum(catIds.filter((id) => cat(id).essential), (id) => avgC.get(id) || 0);
  const flexible = sum(catIds.filter((id) => !cat(id).essential), (id) => avgC.get(id) || 0);

  const html = `
  <section class="kpis">
    <div class="kpi"><span class="kpi-label">Avg. income / month</span><span class="kpi-value">${amt(avgInc)}</span><span class="delta">${months.length} month(s): ${months.map((m) => monthLabel(m)).join(', ')}</span></div>
    <div class="kpi"><span class="kpi-label">Avg. expenses / month</span><span class="kpi-value">${amt(avgExp)}</span><span class="delta">essential ${money0(essential)} · flexible ${money0(flexible)}</span></div>
    <div class="kpi"><span class="kpi-label">Free to save / invest</span><span class="kpi-value ${avgInc - avgExp < 0 ? 'neg-ink' : 'pos-ink'}">${amt(avgInc - avgExp)}</span><span class="delta">${avgInc ? pct((avgInc - avgExp) / avgInc) + ' savings rate' : ''}</span></div>
    <div class="kpi"><span class="kpi-label">Potential extra savings</span><span class="kpi-value pos-ink">${amt(potential)}</span><span class="delta">per month, if you follow the ideas below</span></div>
  </section>
  <section class="grid-2">
    <div class="card"><h3>Suggestions for you</h3>${sugg.map(suggestionHtml).join('')}
      <p class="tiny muted">Suggestions are calculated on this device from your own data. They are general information, not personal financial advice. Tax figures are for Belgium (tax year 2026) – check the linked sources for the latest rules.</p></div>
    <div>
      <div class="card"><h3>Your savings ladder</h3>
        <ol class="ladder">
          <li class="${avgInc - avgExp > 0 ? 'done' : ''}"><strong>Spend less than you earn</strong><span>${money0(avgInc - avgExp)}/month left over</span></li>
          <li class="${state.transactions.some((t) => t.categoryId === 'fees' && /rente|intrest/.test(normalize(t.description))) ? '' : 'done'}"><strong>No expensive debt</strong><span>Pay the full credit-card balance every month</span></li>
          <li class="${liquid >= emergency && emergency > 0 ? 'done' : ''}"><strong>Emergency fund (${state.settings.emergencyMonths} months)</strong><span>${money0(liquid)} of ${money0(emergency)}</span>
            <div class="progress thin"><div class="bar ok" style="width:${emergency ? Math.min(100, (liquid / emergency) * 100) : 0}%"></div></div></li>
          <li><strong>Pension savings – both partners</strong><span>Tax reduction up to €1,050 (30%) or €1,350 (25%) each</span></li>
          <li><strong>Invest the rest, long term</strong><span>Low-cost, diversified, automatic monthly plan</span></li>
        </ol>
      </div>
      <div class="card"><h3>What could investing do?</h3>
        <div class="row3">
          <label>Per month (€)<input id="pj-m" type="number" min="0" step="10" value="${p.monthly}"></label>
          <label>Years<input id="pj-y" type="number" min="1" max="50" value="${p.years}"></label>
          <label>Return %/yr<input id="pj-r" type="number" min="0" max="15" step="0.5" value="${p.rate}"></label>
        </div>
        <p class="big-number">${amt(last.value)}<small> after ${p.years} years · you put in ${money0(last.invested)}</small></p>
        <div class="chart"><canvas id="c-proj"></canvas></div>
        <p class="tiny muted">Illustration only: a constant return is assumed; real returns vary and can be negative, and costs and taxes (e.g. Belgium's 10% capital gains tax above the yearly exemption since 2026, TOB stock-exchange tax) reduce them.</p>
      </div>
    </div>
  </section>
  <div class="card"><h3>Category trends <small>${monthLabel(lm, true)} vs. average of ${prevN || 0} previous month(s)</small></h3>
    ${catIds.length ? `<table class="table"><thead><tr><th>Category</th><th class="r">${monthLabel(lm)}</th><th class="r">Avg before</th><th class="r">Change</th><th class="r">Budget</th></tr></thead><tbody>
    ${catIds.map((id) => { const c = cat(id); const n = nowC.get(id) || 0; const a = avgC.get(id) || 0; const d = a ? (n - a) / a : NaN; return `<tr><td>${c.icon} ${h(c.name)}${c.essential ? '' : ' <span class="tag">flexible</span>'}</td><td class="r">${amt(n)}</td><td class="r">${amt(a)}</td><td class="r ${d > 0.1 ? 'neg-ink' : d < -0.1 ? 'pos-ink' : ''}">${isFinite(d) ? (d > 0 ? '+' : '') + (d * 100).toFixed(0) + '%' : '–'}</td><td class="r">${c.budget ? amt(c.budget) : '–'}</td></tr>`; }).join('')}
    </tbody></table>` : '<p class="muted">No expenses yet.</p>'}
  </div>`;
  const mount = () => {
    const upd = () => {
      ui.projection = { monthly: +$('#pj-m').value || 0, years: Math.max(1, Math.min(50, +$('#pj-y').value || 1)), rate: +$('#pj-r').value || 0 };
      render();
    };
    ['#pj-m', '#pj-y', '#pj-r'].forEach((s) => ($(s).onchange = upd));
    Charts.lineChart($('#c-proj'), proj.map((x) => `Y${x.year}`), [
      { label: 'Value', data: proj.map((x) => Math.round(x.value)), color: Charts.seriesColor(1), fill: true },
      { label: 'Money put in', data: proj.map((x) => Math.round(x.invested)), color: getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim(), dash: [5, 4] },
    ]);
  };
  return { html, mount };
}

// ----------------------------------------------------------------- accounts --
function setBalance(accountId, balance, date) {
  const a = state.accounts.find((x) => x.id === accountId);
  if (!a) return;
  a.balance = round2(balance);
  a.balanceDate = date;
  a.history = (a.history || []).filter((x) => x.date !== date);
  a.history.push({ date, balance: round2(balance) });
  a.history.sort((x, y) => (x.date < y.date ? -1 : 1));
  a.updatedAt = nowIso();
}

function renderAccounts() {
  const months = lastMonths(monthKey(todayStr()), 12);
  const hist = I.netWorthHistory(state, months);
  const hasHist = hist.some((x) => x.value !== null);
  const html = `
  <section class="kpis">
    <div class="kpi"><span class="kpi-label">Net worth</span><span class="kpi-value">${amt(I.netWorth(state))}</span><span class="delta">all accounts, credit cards subtracted</span></div>
    <div class="kpi"><span class="kpi-label">Cash available</span><span class="kpi-value">${amt(I.liquidBalance(state))}</span><span class="delta">current + savings + cash</span></div>
  </section>
  <div class="acc-grid">
    ${state.accounts.map((a) => `
    <div class="card acc-card" style="--acc:${a.color}">
      <div class="acc-top"><span class="acc-badge">${h(a.bank || ACCOUNT_TYPES[a.type])}</span><span class="muted small">${ACCOUNT_TYPES[a.type]} · ${h(ownerName(state, a.owner))}</span></div>
      <h3>${h(a.name)}</h3>
      <p class="acc-bal">${a.type === 'credit' ? `<span class="muted small">Outstanding</span> ` : ''}${amt(a.balance)}</p>
      <p class="muted small">${a.balanceDate ? 'As of ' + formatDate(a.balanceDate) : 'No balance entered yet'}</p>
      <div class="actions"><button class="btn small primary" data-bal="${a.id}">Update balance</button><button class="btn small" data-edit-acc="${a.id}">Edit</button></div>
    </div>`).join('')}
    <button class="card add-card" id="add-acc">+ Add account<br><span class="muted small">savings, investments, joint account…</span></button>
  </div>
  <div class="card"><h3>Net worth over time</h3>${hasHist ? '<div class="chart"><canvas id="c-nw"></canvas></div>' : '<p class="muted">Update your balances regularly (e.g. on the 1st of each month) to see this chart grow.</p>'}</div>`;
  const mount = () => {
    $$('[data-bal]').forEach((b) => (b.onclick = () => balanceModal(b.dataset.bal)));
    $$('[data-edit-acc]').forEach((b) => (b.onclick = () => accountModal(state.accounts.find((a) => a.id === b.dataset.editAcc))));
    $('#add-acc').onclick = () => accountModal();
    if (hasHist) Charts.lineChart($('#c-nw'), months.map((m) => monthLabel(m)), [{ label: 'Net worth', data: hist.map((x) => x.value), color: Charts.seriesColor(1), fill: true }], { legend: false });
  };
  return { html, mount };
}

function balanceModal(id) {
  const a = acc(id);
  openModal(`Balance – ${a.name}`, `<form id="bal-form" class="form">
    <label>${a.type === 'credit' ? 'Amount outstanding on the card (€)' : 'Current balance (€)'}<input name="bal" type="text" inputmode="decimal" value="${a.balance ? String(a.balance).replace('.', ',') : ''}" required></label>
    <label>Date<input name="date" type="date" value="${todayStr()}" required></label>
    ${(a.history || []).length ? `<details><summary>History (${a.history.length})</summary><ul class="hist">${[...a.history].reverse().map((x) => `<li>${formatDate(x.date)} <span class="grow"></span>${amt(x.balance)}</li>`).join('')}</ul></details>` : ''}
    <div class="actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save</button></div></form>`, {
    onMount: (m) => {
      m.querySelector('#bal-form').onsubmit = (e) => {
        e.preventDefault();
        const v = parseFloat(e.target.bal.value.replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
        if (!isFinite(v)) return toast('Enter a number', 'error');
        setBalance(id, v, e.target.date.value);
        closeModal();
        commit();
      };
    },
  });
}

function accountModal(a) {
  const isNew = !a;
  const x = a ? { ...a } : { id: uid(), name: '', bank: '', type: 'savings', owner: 'joint', color: PALETTE[state.accounts.length % PALETTE.length], balance: 0, balanceDate: '', history: [] };
  openModal(isNew ? 'Add account' : 'Edit account', `<form id="acc-form" class="form">
    <label>Name<input name="name" value="${h(x.name)}" required placeholder="e.g. Belfius savings"></label>
    <div class="row2"><label>Bank<input name="bank" value="${h(x.bank)}" placeholder="Belfius, KBC, Beobank…"></label>
    <label>Type<select name="type">${Object.entries(ACCOUNT_TYPES).map(([k, v]) => `<option value="${k}" ${x.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label></div>
    <div class="row2"><label>Owner<select name="owner">${ownerOptions(x.owner)}</select></label>
    <label>Colour<select name="color">${PALETTE.map((c, i) => `<option value="${c}" ${x.color === c ? 'selected' : ''} style="color:${c}">● Colour ${i + 1}</option>`).join('')}</select></label></div>
    <div class="actions">${isNew ? '' : '<button type="button" class="btn danger" id="acc-del">Delete</button>'}<span class="grow"></span><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save</button></div></form>`, {
    onMount: (m) => {
      m.querySelector('#acc-del')?.addEventListener('click', async () => {
        const n = state.transactions.filter((t) => t.accountId === x.id).length;
        if (n) return toast(`This account has ${n} transaction(s). Move or delete them first.`, 'error');
        if (!(await confirmBox(`Delete account “${h(x.name)}”?`))) return;
        state.accounts = state.accounts.filter((y) => y.id !== x.id);
        markDeleted(x.id);
        commit();
      });
      m.querySelector('#acc-form').onsubmit = (e) => {
        e.preventDefault();
        const f = e.target;
        Object.assign(x, { name: f.name.value.trim(), bank: f.bank.value.trim(), type: f.type.value, owner: f.owner.value, color: f.color.value, updatedAt: nowIso() });
        if (isNew) state.accounts.push(x);
        else state.accounts = state.accounts.map((y) => (y.id === x.id ? x : y));
        closeModal();
        commit();
      };
    },
  });
}

// --------------------------------------------------------------------- plan --
function pendingRecurring(month) {
  const today = todayStr();
  return state.recurring.filter((r) => {
    if (!r.active || !(r.amount > 0)) return false;
    const date = `${month}-${String(Math.min(r.day || 1, 28)).padStart(2, '0')}`;
    if (date > today) return false;
    return !state.transactions.some((t) => t.recurringId === r.id && monthKey(t.date) === month);
  });
}

function postRecurring(month) {
  const items = pendingRecurring(month);
  const t = nowIso();
  for (const r of items) {
    state.transactions.push({ id: uid(), date: `${month}-${String(Math.min(r.day || 1, 28)).padStart(2, '0')}`, description: r.name, amount: r.amount, type: r.type, categoryId: r.categoryId, accountId: r.accountId, owner: r.owner, note: '', source: 'recurring', recurringId: r.id, createdAt: t, updatedAt: t });
  }
  commit();
  toast(`${items.length} recurring item(s) added`, 'ok');
}

function renderPlan() {
  const lm = I.latestMonth(state);
  const budgets = new Map(I.budgetStatus(state, lm).map((b) => [b.category.id, b]));
  const incomeRec = state.recurring.filter((r) => r.type === 'income');
  const costRec = state.recurring.filter((r) => r.type === 'expense');
  const totalInc = sum(incomeRec.filter((r) => r.active), (r) => r.amount);
  const totalFixed = sum(costRec.filter((r) => r.active), (r) => r.amount);
  const recRow = (r) => `<div class="rec-row ${r.active ? '' : 'off'}"><span class="tx-ic">${cat(r.categoryId).icon}</span><span class="grow"><strong>${h(r.name)}</strong><br><span class="muted small">${h(acc(r.accountId).name)} · day ${r.day} · ${h(ownerName(state, r.owner))}${r.active ? '' : ' · paused'}</span></span>${r.type === 'income' ? amt(r.amount, 'pos') : amt(r.amount, 'neg')}<button class="icon-btn" data-rec="${r.id}" aria-label="Edit">✎</button></div>`;
  const html = `
  <section class="grid-2">
    <div class="card"><h3>Monthly income</h3>
      <p class="muted small">Your salary, your partner's salary and the rental income. These can be added to the books automatically each month (if you don't import them from statements).</p>
      ${incomeRec.map(recRow).join('') || '<p class="muted">None yet.</p>'}
      <div class="rec-total"><span>Total planned income</span>${amt(totalInc, 'pos')}</div>
      <button class="btn small" id="add-inc">+ Add income</button>
    </div>
    <div class="card"><h3>Fixed monthly costs</h3>
      <p class="muted small">Rent/mortgage, loans, insurance, subscriptions… paid every month.</p>
      ${costRec.map(recRow).join('') || '<p class="muted">None yet.</p>'}
      <div class="rec-total"><span>Total fixed costs</span>${amt(totalFixed, 'neg')}</div>
      <button class="btn small" id="add-cost">+ Add fixed cost</button>
    </div>
  </section>
  <div class="card"><div class="plan-sum"><div><span class="kpi-label">Planned income</span>${amt(totalInc)}</div><div><span class="kpi-label">− fixed costs</span>${amt(totalFixed)}</div><div><span class="kpi-label">= left for variable spending &amp; saving</span><strong>${amt(totalInc - totalFixed)}</strong></div>
    <div><span class="kpi-label">Saving target (${state.settings.savingsTargetPct}%)</span><strong>${amt((totalInc * state.settings.savingsTargetPct) / 100)}</strong></div></div></div>
  <div class="card"><h3>Budgets per category <small>${monthLabel(lm, true)}</small></h3>
    <p class="muted small">Set a monthly limit for flexible categories. 0 = no budget.</p>
    <div class="budgets">${state.categories.filter((c) => c.kind === 'expense').map((c) => { const b = budgets.get(c.id); const r = b ? b.ratio : 0; return `
      <div class="budget-row"><span class="grow">${c.icon} ${h(c.name)}</span>
        ${b ? `<span class="small ${r >= 1 ? 'neg-ink' : ''}">${money0(b.spent)} / </span>` : ''}
        <input type="number" min="0" step="10" class="budget-in" data-cat="${c.id}" value="${c.budget || ''}" placeholder="0" aria-label="Budget for ${h(c.name)}"></div>
      ${b ? `<div class="progress thin"><div class="bar ${r >= 1 ? 'bad' : r >= 0.85 ? 'mid' : 'ok'}" style="width:${Math.min(100, r * 100)}%"></div></div>` : ''}`; }).join('')}</div>
  </div>
  <div class="card"><h3>Savings goals</h3>
    ${state.goals.map((g) => { const r = g.target ? g.saved / g.target : 0; const monthsLeft = g.deadline ? Math.max(1, Math.round((new Date(g.deadline) - new Date()) / (30.4 * 86400000))) : null; return `
      <div class="goal"><div class="goal-head"><strong>${h(g.name)}</strong><span>${amt(g.saved)} / ${amt(g.target)}</span><button class="icon-btn" data-goal="${g.id}" aria-label="Edit">✎</button></div>
      <div class="progress"><div class="bar ok" style="width:${Math.min(100, r * 100)}%"></div></div>
      <span class="muted small">${pct(r)}${monthsLeft ? ` · ${money0(Math.max(0, g.target - g.saved) / monthsLeft)}/month needed until ${formatDate(g.deadline)}` : ''}</span></div>`; }).join('') || '<p class="muted">E.g. emergency fund, holiday, new car, house renovation.</p>'}
    <button class="btn small" id="add-goal">+ Add goal</button>
  </div>`;
  const mount = () => {
    $('#add-inc').onclick = () => recurringModal(null, 'income');
    $('#add-cost').onclick = () => recurringModal(null, 'expense');
    $$('[data-rec]').forEach((b) => (b.onclick = () => recurringModal(state.recurring.find((r) => r.id === b.dataset.rec))));
    $$('.budget-in').forEach((inp) => (inp.onchange = () => { const c = state.categories.find((x) => x.id === inp.dataset.cat); c.budget = Math.max(0, +inp.value || 0); c.updatedAt = nowIso(); commit(); }));
    $('#add-goal').onclick = () => goalModal();
    $$('[data-goal]').forEach((b) => (b.onclick = () => goalModal(state.goals.find((g) => g.id === b.dataset.goal))));
  };
  return { html, mount };
}

function recurringModal(r, type) {
  const isNew = !r;
  const x = r ? { ...r } : { id: uid(), name: '', type, amount: 0, categoryId: type === 'income' ? 'salary' : 'housing', accountId: state.accounts[0]?.id, owner: 'joint', day: 1, active: true };
  openModal(isNew ? (type === 'income' ? 'Add income' : 'Add fixed cost') : 'Edit', `<form id="rec-form" class="form">
    <label>Name<input name="name" value="${h(x.name)}" required placeholder="${x.type === 'income' ? 'e.g. Salary – Me' : 'e.g. Mortgage'}"></label>
    <div class="row2"><label>Amount per month (€)<input name="amount" type="text" inputmode="decimal" value="${x.amount ? String(x.amount).replace('.', ',') : ''}" required></label>
    <label>Day of month<input name="day" type="number" min="1" max="28" value="${x.day}"></label></div>
    <div class="row2"><label>Category<select name="categoryId">${categoryOptions(x.categoryId, x.type)}</select></label>
    <label>${x.type === 'income' ? 'Paid into' : 'Paid from'}<select name="accountId">${accountOptions(x.accountId)}</select></label></div>
    <label>Person<select name="owner">${ownerOptions(x.owner)}</select></label>
    <label class="check"><input type="checkbox" name="active" ${x.active ? 'checked' : ''}> Active</label>
    <div class="actions">${isNew ? '' : '<button type="button" class="btn danger" id="rec-del">Delete</button>'}<span class="grow"></span><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save</button></div></form>`, {
    onMount: (m) => {
      m.querySelector('#rec-del')?.addEventListener('click', () => { state.recurring = state.recurring.filter((y) => y.id !== x.id); markDeleted(x.id); closeModal(); commit(); });
      m.querySelector('#rec-form').onsubmit = (e) => {
        e.preventDefault();
        const f = e.target;
        const amount = parseFloat(f.amount.value.replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
        if (!isFinite(amount) || amount < 0) return toast('Enter an amount', 'error');
        Object.assign(x, { name: f.name.value.trim(), amount: round2(amount), day: Math.max(1, Math.min(28, +f.day.value || 1)), categoryId: f.categoryId.value, accountId: f.accountId.value, owner: f.owner.value, active: f.active.checked, updatedAt: nowIso() });
        if (isNew) state.recurring.push(x);
        else state.recurring = state.recurring.map((y) => (y.id === x.id ? x : y));
        closeModal();
        commit();
      };
    },
  });
}

function goalModal(g) {
  const isNew = !g;
  const x = g ? { ...g } : { id: uid(), name: '', target: 0, saved: 0, deadline: '' };
  openModal(isNew ? 'Add goal' : 'Edit goal', `<form id="goal-form" class="form">
    <label>Goal<input name="name" value="${h(x.name)}" required placeholder="e.g. Emergency fund"></label>
    <div class="row2"><label>Target (€)<input name="target" type="number" min="0" step="50" value="${x.target || ''}" required></label>
    <label>Saved so far (€)<input name="saved" type="number" min="0" step="10" value="${x.saved || ''}"></label></div>
    <label>Target date (optional)<input name="deadline" type="date" value="${x.deadline || ''}"></label>
    <div class="actions">${isNew ? '' : '<button type="button" class="btn danger" id="goal-del">Delete</button>'}<span class="grow"></span><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save</button></div></form>`, {
    onMount: (m) => {
      m.querySelector('#goal-del')?.addEventListener('click', () => { state.goals = state.goals.filter((y) => y.id !== x.id); markDeleted(x.id); closeModal(); commit(); });
      m.querySelector('#goal-form').onsubmit = (e) => {
        e.preventDefault();
        const f = e.target;
        Object.assign(x, { name: f.name.value.trim(), target: +f.target.value || 0, saved: +f.saved.value || 0, deadline: f.deadline.value, updatedAt: nowIso() });
        if (isNew) state.goals.push(x);
        else state.goals = state.goals.map((y) => (y.id === x.id ? x : y));
        closeModal();
        commit();
      };
    },
  });
}

// ----------------------------------------------------------------- settings --
function renderSettings() {
  const s = state.settings;
  const custom = state.categories.filter((c) => c.custom);
  const html = `
  <section class="grid-2">
    <div class="card"><h3>Household</h3>
      <form id="set-form" class="form">
        <div class="row2"><label>Your name<input name="meName" value="${h(s.meName)}"></label><label>Partner's name<input name="partnerName" value="${h(s.partnerName)}"></label></div>
        <div class="row2"><label>Savings target (% of income)<input name="savingsTargetPct" type="number" min="0" max="90" value="${s.savingsTargetPct}"></label>
        <label>Emergency fund (months of expenses)<input name="emergencyMonths" type="number" min="1" max="24" value="${s.emergencyMonths}"></label></div>
        <div class="row2"><label>Expected investment return (%/yr)<input name="expectedReturnPct" type="number" min="0" max="15" step="0.5" value="${s.expectedReturnPct}"></label>
        <label>Auto-lock after (minutes)<input name="autoLockMin" type="number" min="1" max="60" value="${s.autoLockMin}"></label></div>
        <label>Appearance<select name="theme"><option value="auto" ${s.theme === 'auto' ? 'selected' : ''}>Follow system</option><option value="light" ${s.theme === 'light' ? 'selected' : ''}>Light</option><option value="dark" ${s.theme === 'dark' ? 'selected' : ''}>Dark</option></select></label>
        <div class="actions"><span class="grow"></span><button class="btn primary">Save settings</button></div>
      </form>
    </div>
    <div class="card"><h3>Backup &amp; sync between Mac and iPhone</h3>
      <p class="muted small">Your data is stored only on this device. A backup is an <strong>encrypted file</strong> (same passcode). To move data between your Mac and iPhone, export on one device, save the file to iCloud Drive / Files or AirDrop it, and import it on the other with “Merge”.</p>
      <p class="small">Last backup: <strong>${s.lastBackupAt ? formatDate(s.lastBackupAt.slice(0, 10)) : 'never'}</strong></p>
      <div class="actions wrap"><button class="btn primary" id="bk-exp">Export encrypted backup</button><button class="btn" id="bk-imp">Import / merge backup</button><button class="btn" id="csv-exp">Export all as CSV</button></div>
    </div>
  </section>
  <section class="grid-2">
    <div class="card"><h3>Security</h3>
      <ul class="sec-list">
        <li>🔐 Encrypted with AES-256-GCM, key derived from your passcode (PBKDF2, 600,000 rounds).</li>
        <li>📵 No server, no account, no analytics. The app's security policy blocks all connections to other websites.</li>
        <li>🧠 Text recognition (OCR) runs on this device. Screenshots and PDFs are not stored – only the transactions you approve.</li>
        <li>⏱️ Locks automatically after ${s.autoLockMin} minute(s) of inactivity.</li>
      </ul>
      <div class="actions wrap"><button class="btn" id="chg-pass">Change passcode</button><button class="btn" id="lock-now">Lock now</button><button class="btn danger" id="wipe">Erase all data</button></div>
    </div>
    <div class="card"><h3>Categories &amp; learned rules</h3>
      <p class="muted small">When you change the category of a transaction, the app remembers it for that merchant.</p>
      ${state.rules.length ? `<ul class="rules">${state.rules.map((r) => `<li><code>${h(r.pattern)}</code> → ${cat(r.categoryId).icon} ${h(cat(r.categoryId).name)}<button class="icon-btn" data-del-rule="${r.id}" aria-label="Delete rule">✕</button></li>`).join('')}</ul>` : '<p class="muted small">No learned rules yet.</p>'}
      ${custom.length ? `<p class="small"><strong>Your categories:</strong> ${custom.map((c) => `${c.icon} ${h(c.name)} <button class="link small" data-del-cat="${c.id}">remove</button>`).join(' · ')}</p>` : ''}
      <button class="btn small" id="add-cat">+ Add category</button>
    </div>
  </section>`;
  const mount = () => {
    $('#set-form').onsubmit = (e) => {
      e.preventDefault();
      const f = e.target;
      Object.assign(s, { meName: f.meName.value.trim() || 'Me', partnerName: f.partnerName.value.trim() || 'Partner', savingsTargetPct: +f.savingsTargetPct.value || 0, emergencyMonths: +f.emergencyMonths.value || 6, expectedReturnPct: +f.expectedReturnPct.value || 0, autoLockMin: Math.max(1, +f.autoLockMin.value || 5), theme: f.theme.value });
      ui.projection = null;
      applyTheme();
      commit();
      toast('Settings saved', 'ok');
    };
    $('#bk-exp').onclick = exportBackup;
    $('#bk-imp').onclick = () => restoreBackup(false);
    $('#csv-exp').onclick = () => exportCsv([...state.transactions].sort((a, b) => (a.date < b.date ? -1 : 1)));
    $('#lock-now').onclick = lockNow;
    $('#chg-pass').onclick = changePasscode;
    $('#wipe').onclick = async () => {
      if (!(await confirmBox('This permanently erases all data on this device. Make a backup first if you want to keep anything.', 'Erase everything'))) return;
      await vault.wipe();
      location.reload();
    };
    $$('[data-del-rule]').forEach((b) => (b.onclick = () => { state.rules = state.rules.filter((r) => r.id !== b.dataset.delRule); markDeleted(b.dataset.delRule); commit(); }));
    $$('[data-del-cat]').forEach((b) => (b.onclick = async () => {
      const id = b.dataset.delCat;
      const n = state.transactions.filter((t) => t.categoryId === id).length;
      if (n && !(await confirmBox(`${n} transaction(s) use this category. They will move to “Other”.`, 'Remove'))) return;
      const kind = cat(id).kind;
      state.transactions.forEach((t) => { if (t.categoryId === id) { t.categoryId = kind === 'income' ? 'other-inc' : kind === 'transfer' ? 'transfer' : 'other-exp'; t.updatedAt = nowIso(); } });
      state.categories = state.categories.filter((c) => c.id !== id);
      markDeleted(id);
      commit();
    }));
    $('#add-cat').onclick = () => openModal('Add category', `<form id="cat-form" class="form"><div class="row2"><label>Icon (emoji)<input name="icon" value="🏷️" maxlength="4"></label><label>Type<select name="kind"><option value="expense">Expense</option><option value="income">Income</option></select></label></div><label>Name<input name="name" required></label><label class="check"><input type="checkbox" name="essential"> Essential (needs) – not flexible</label><div class="actions"><span class="grow"></span><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Add</button></div></form>`, {
      onMount: (m) => (m.querySelector('#cat-form').onsubmit = (e) => {
        e.preventDefault();
        const f = e.target;
        state.categories.push({ id: 'c-' + uid().slice(0, 8), name: f.name.value.trim(), kind: f.kind.value, icon: f.icon.value || '🏷️', budget: 0, essential: f.essential.checked, custom: true, updatedAt: nowIso() });
        closeModal();
        commit();
      }),
    });
  };
  return { html, mount };
}

async function exportBackup() {
  const data = await vault.exportBackup(state);
  state.settings.lastBackupAt = nowIso();
  await vault.save(state);
  download(`cashflow-backup-${todayStr()}.cfbackup`, JSON.stringify(data), 'application/octet-stream');
  toast('Backup created. Store it somewhere safe (e.g. iCloud Drive).', 'ok');
  render();
}

function restoreBackup(fromLockScreen) {
  const m0 = openModal('Restore a backup', `<p class="muted small">Choose the backup file, or paste the backup text you copied earlier.</p>
    <div class="actions"><button class="btn primary" id="rb-file">Choose file</button></div>
    <label>Or paste backup text<textarea id="rb-text" rows="5"></textarea></label>
    <div class="actions"><span class="grow"></span><button class="btn" data-close>Cancel</button><button class="btn primary" id="rb-go">Use pasted text</button></div>`);
  m0.querySelector('#rb-go').onclick = () => { const t = m0.querySelector('#rb-text').value.trim(); if (t) handleBackupText(t); };
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.cfbackup,application/json,application/octet-stream,text/plain';
  m0.querySelector('#rb-file').onclick = () => input.click();
  input.onchange = async () => {
    const file = input.files[0];
    if (file) handleBackupText(await file.text());
  };

  async function handleBackupText(text) {
    let obj;
    try {
      obj = JSON.parse(text);
    } catch {
      return toast('This is not a valid backup.', 'error');
    }
    const pass = await askText('Backup passcode', 'Enter the passcode that was used when this backup was made');
    if (pass === null) return;
    let incoming;
    try {
      incoming = migrate(await Vault.readBackup(obj, pass));
    } catch (e) {
      return toast(e.message.includes('Cashflow') ? e.message : 'Wrong passcode for this backup.', 'error');
    }
    if (fromLockScreen) {
      state = incoming;
      await vault.create(pass, state);
      toast('Backup restored. Your passcode is the backup passcode.', 'ok');
      return start();
    }
    const m = openModal('Import backup', `<p>Backup from ${h(formatDate((obj.exportedAt || '').slice(0, 10)))} with ${incoming.transactions.length} transactions.</p>
      <p class="muted small"><strong>Merge</strong> combines both (newest edit wins, deletions are applied) – use this to sync between Mac and iPhone. <strong>Replace</strong> throws away the data on this device.</p>
      <div class="actions"><button class="btn" data-close>Cancel</button><button class="btn danger" id="bk-replace">Replace</button><button class="btn primary" id="bk-merge">Merge</button></div>`);
    m.querySelector('#bk-merge').onclick = () => { state = mergeStates(state, incoming); closeModal(); commit(); toast('Backup merged', 'ok'); };
    m.querySelector('#bk-replace').onclick = () => { state = incoming; closeModal(); commit(); toast('Data replaced from backup', 'ok'); };
  }
}

async function changePasscode() {
  openModal('Change passcode', `<form id="pc-form" class="form"><label>Current passcode<input name="old" type="password" required autocomplete="current-password"></label><label>New passcode<input name="p1" type="password" minlength="6" required autocomplete="new-password"></label><label>Repeat new passcode<input name="p2" type="password" minlength="6" required autocomplete="new-password"></label><div class="actions"><span class="grow"></span><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Change</button></div></form>`, {
    onMount: (m) => (m.querySelector('#pc-form').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      if (f.p1.value !== f.p2.value) return toast('New passcodes do not match', 'error');
      try {
        await new Vault().unlock(f.old.value);
      } catch {
        return toast('Current passcode is wrong', 'error');
      }
      await vault.changePasscode(f.p1.value, state);
      closeModal();
      toast('Passcode changed. Older backups still use the old passcode.', 'ok');
    }),
  });
}

function logoSvg() {
  return `<svg viewBox="0 0 64 64" width="32" height="32" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a78d6"/><stop offset="1" stop-color="#1baf7a"/></linearGradient></defs><rect width="64" height="64" rx="15" fill="url(#lg)"/><path d="M14 42 L26 30 L34 37 L50 20" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><path d="M41 20 H50 V29" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

// -------------------------------------------------------------------- boot --
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
showLock();
