// Company fundamentals per quarter: revenue, gross/operating/net profit, EPS, operating cash flow, capex, free cash
// flow, debt, cash and equity, from SEC EDGAR company facts (US filers), the free Yahoo fundamentals feed or FMP.
// Rows: [{end, filed, rev, gross, op, net, eps, ocf, capex, fcf, debt, cash, equity}] oldest first.

const DAY = 864e5;
const days = (a, b) => (Date.parse(b) - Date.parse(a)) / DAY;

/* ---------- SEC EDGAR ---------- */
export const SEC_TAGS = {
  rev: ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'SalesRevenueNet', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'SalesRevenueGoodsNet'],
  gross: ['GrossProfit'],
  op: ['OperatingIncomeLoss'],
  net: ['NetIncomeLoss', 'ProfitLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic'],
  eps: ['EarningsPerShareDiluted', 'EarningsPerShareBasicAndDiluted', 'EarningsPerShareBasic'],
  ocf: ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'],
  capex: ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets', 'PaymentsForCapitalImprovements'],
  ltd: ['LongTermDebt', 'LongTermDebtAndCapitalLeaseObligations', 'DebtLongtermAndShorttermCombinedAmount'],
  ltdNon: ['LongTermDebtNoncurrent', 'LongTermDebtAndCapitalLeaseObligationsNoncurrent'],
  ltdCur: ['LongTermDebtCurrent', 'DebtCurrent', 'LongTermDebtAndCapitalLeaseObligationsCurrent'],
  short: ['ShortTermBorrowings', 'CommercialPaper'],
  cash: ['CashAndCashEquivalentsAtCarryingValue', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents', 'Cash'],
  sti: ['ShortTermInvestments', 'MarketableSecuritiesCurrent', 'AvailableForSaleSecuritiesDebtSecuritiesCurrent'],
  equity: ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'],
};
const FORMS = /^(10-Q|10-K|10-KT|10-QT|20-F|40-F|6-K)(\/A)?$/;

/** Facts of the first tag that covers each period (tags in priority order). */
function facts(g, tags, unitRe) {
  const out = [], have = new Set();
  for (const t of tags) {
    const u = g[t] && g[t].units; if (!u) continue;
    const k = Object.keys(u).find(x => unitRe.test(x)); if (!k) continue;
    const fs = u[k].filter(f => FORMS.test(f.form || '') && f.val != null);
    const key = f => (f.start || '') + '|' + f.end;
    fs.filter(f => !have.has(key(f))).forEach(f => out.push(f));
    fs.forEach(f => have.add(key(f)));
  }
  return out;
}

/** Duration facts → one value per quarter end. Uses 3-month periods, else differences of year-to-date figures. */
export function quarterize(fs) {
  const per = new Map(); // start|end -> latest filing wins (restatements), first filing date kept
  for (const f of fs) {
    if (!f.start) continue;
    const k = f.start + '|' + f.end, p = per.get(k);
    if (!p) per.set(k, { start: f.start, end: f.end, val: f.val, filed: f.filed, last: f.filed });
    else { if (f.filed < p.filed) p.filed = f.filed; if (f.filed >= p.last) { p.last = f.filed; p.val = f.val; } }
  }
  const P = [...per.values()], q = new Map();
  for (const p of P) { const d = days(p.start, p.end); if (d >= 75 && d <= 105) q.set(p.end, { end: p.end, v: p.val, filed: p.filed }); }
  // year-to-date chains: same start, longer periods → the quarter is the difference with the previous one
  const byStart = new Map(); P.forEach(p => { if (!byStart.has(p.start)) byStart.set(p.start, []); byStart.get(p.start).push(p); });
  for (const list of byStart.values()) {
    list.sort((a, b) => a.end.localeCompare(b.end));
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1], b = list[i], step = days(a.end, b.end);
      if (step >= 75 && step <= 105 && !q.has(b.end)) q.set(b.end, { end: b.end, v: b.val - a.val, filed: b.filed, derived: true });
    }
  }
  // Q4 often appears only inside the full year: year minus the three quarters before it
  for (const y of P) {
    const d = days(y.start, y.end); if (d < 340 || d > 380 || q.has(y.end)) continue;
    const inYear = [...q.values()].filter(x => days(y.start, x.end) > 60 && days(x.end, y.end) >= 60);
    if (inYear.length === 3) q.set(y.end, { end: y.end, v: y.val - inYear.reduce((s, x) => s + x.v, 0), filed: y.filed, derived: true });
  }
  return q;
}

/** Instant facts (balance sheet) → value per date. */
function instants(fs) {
  const m = new Map();
  for (const f of fs) { if (f.start) continue; const p = m.get(f.end); if (!p || f.filed >= p.filed) m.set(f.end, { v: f.val, filed: f.filed }); }
  return m;
}

export function parseSecFundamentals(doc) {
  const g = (doc && doc.facts && doc.facts['us-gaap']) || {};
  const money = /^[A-Z]{3}$/, perShare = /^[A-Z]{3}\/shares$/;
  const cur = (() => { for (const t of SEC_TAGS.rev) { const u = g[t] && g[t].units; if (u) { const k = Object.keys(u).find(x => money.test(x)); if (k) return k; } } return 'USD'; })();
  const Q = Object.fromEntries(['rev', 'gross', 'op', 'net', 'ocf', 'capex'].map(k => [k, quarterize(facts(g, SEC_TAGS[k], money))]));
  Q.eps = quarterize(facts(g, SEC_TAGS.eps, perShare));
  const I = Object.fromEntries(['ltd', 'ltdNon', 'ltdCur', 'short', 'cash', 'sti', 'equity'].map(k => [k, instants(facts(g, SEC_TAGS[k], money))]));
  const ends = [...new Set([...Q.rev.keys(), ...Q.net.keys(), ...Q.ocf.keys()])].sort();
  const near = (m, end) => { if (m.has(end)) return m.get(end); for (const [e, v] of m) if (Math.abs(days(e, end)) <= 10) return v; return null; };
  const val = (m, end) => { const x = near(m, end); return x ? x.v : null; };
  const rows = ends.map(end => {
    const ltd = val(I.ltd, end), non = val(I.ltdNon, end), cu = val(I.ltdCur, end), sh = val(I.short, end);
    const debt = ltd != null ? ltd + (sh || 0) : non != null || cu != null ? (non || 0) + (cu || 0) + (sh || 0) : sh;
    const c = val(I.cash, end), s = val(I.sti, end);
    const ocf = val(Q.ocf, end), capex = val(Q.capex, end);
    const filed = [Q.rev, Q.net, Q.ocf].map(m => near(m, end)).filter(Boolean).map(x => x.filed).sort()[0] || null;
    return { end, filed, rev: val(Q.rev, end), gross: val(Q.gross, end), op: val(Q.op, end), net: val(Q.net, end), eps: val(Q.eps, end), ocf, capex, fcf: ocf != null ? ocf - (capex || 0) : null, debt, cash: c != null ? c + (s || 0) : null, equity: val(I.equity, end) };
  });
  // a quarter needs at least revenue or profit; drop late restatement-only periods
  return { cur, rows: rows.filter(r => (r.rev != null || r.net != null) && (!r.filed || days(r.end, r.filed) <= 200)) };
}

/* ---------- Yahoo fundamentals time series ---------- */
export const YAHOO_TYPES = { rev: 'TotalRevenue', gross: 'GrossProfit', op: 'OperatingIncome', net: 'NetIncome', eps: 'DilutedEPS', ocf: 'OperatingCashFlow', capex: 'CapitalExpenditure', fcf: 'FreeCashFlow', debt: 'TotalDebt', cash: 'CashCashEquivalentsAndShortTermInvestments', equity: 'StockholdersEquity' };
export function parseYahooFundamentals(d, prefix = 'quarterly') {
  const res = (d && d.timeseries && d.timeseries.result) || [], m = new Map(); let cur = null;
  for (const [k, t] of Object.entries(YAHOO_TYPES)) {
    const r = res.find(x => x.meta && x.meta.type && x.meta.type[0] === prefix + t); if (!r) continue;
    for (const x of r[prefix + t] || []) {
      if (!x || !x.reportedValue || x.reportedValue.raw == null) continue;
      if (!m.has(x.asOfDate)) m.set(x.asOfDate, { end: x.asOfDate, filed: null });
      m.get(x.asOfDate)[k] = k === 'capex' ? Math.abs(x.reportedValue.raw) : x.reportedValue.raw; cur = cur || x.currencyCode;
    }
  }
  const rows = [...m.values()].sort((a, b) => a.end.localeCompare(b.end));
  rows.forEach(r => { if (r.fcf == null && r.ocf != null) r.fcf = r.ocf - (r.capex || 0); });
  return { cur: cur || null, rows };
}

/* ---------- FMP statements ---------- */
export function parseFmpFundamentals(inc, cf, bs) {
  const m = new Map(), get = d => { if (!m.has(d)) m.set(d, { end: d, filed: null }); return m.get(d); };
  let cur = null;
  (inc || []).forEach(x => { const r = get(x.date); Object.assign(r, { rev: x.revenue, gross: x.grossProfit, op: x.operatingIncome, net: x.netIncome, eps: x.epsDiluted ?? x.epsdiluted ?? x.eps, filed: (x.filingDate || x.fillingDate || '').slice(0, 10) || null }); cur = cur || x.reportedCurrency; });
  (cf || []).forEach(x => { const r = get(x.date); Object.assign(r, { ocf: x.operatingCashFlow, capex: x.capitalExpenditure != null ? Math.abs(x.capitalExpenditure) : null, fcf: x.freeCashFlow }); });
  (bs || []).forEach(x => { const r = get(x.date); Object.assign(r, { debt: x.totalDebt, cash: (x.cashAndCashEquivalents || 0) + (x.shortTermInvestments || 0), equity: x.totalStockholdersEquity }); });
  return { cur, rows: [...m.values()].filter(r => r.rev != null || r.net != null).sort((a, b) => a.end.localeCompare(b.end)) };
}

/* ---------- derived figures ---------- */
const FLOWS = ['rev', 'gross', 'op', 'net', 'eps', 'ocf', 'capex', 'fcf'];
/** Trailing twelve months: flows summed over 4 consecutive quarters (balance items as reported). */
export function ttm(rows) {
  return rows.map((r, i) => {
    if (i < 3) return null;
    const w = rows.slice(i - 3, i + 1);
    if (days(w[0].end, r.end) > 300) return null; // a gap in the quarters
    const o = { ...r };
    for (const k of FLOWS) o[k] = w.every(x => x[k] != null) ? w.reduce((s, x) => s + x[k], 0) : null;
    return o;
  }).filter(Boolean);
}
export const margins = r => ({
  gross: r.rev ? (r.gross != null ? r.gross / r.rev : null) : null, op: r.rev && r.op != null ? r.op / r.rev : null,
  net: r.rev && r.net != null ? r.net / r.rev : null, fcf: r.rev && r.fcf != null ? r.fcf / r.rev : null,
});
/** Year-over-year change of field k for the last row (same quarter a year earlier). */
export function yoy(rows, k) {
  const z = rows[rows.length - 1]; if (!z || z[k] == null) return null;
  const a = rows.find(r => Math.abs(days(r.end, z.end) - 365) <= 20);
  return a && a[k] ? (z[k] - a[k]) / Math.abs(a[k]) : null;
}
