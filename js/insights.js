// Analytics + rule-based saving suggestions. Pure functions over the app state.
import { monthKey, lastMonths, addMonths, sum, groupBy, normalize, todayStr } from './util.js';
import { merchantKey } from './categorize.js';

export function catMap(state) {
  return new Map(state.categories.map((c) => [c.id, c]));
}

export function accMap(state) {
  return new Map(state.accounts.map((a) => [a.id, a]));
}

/** Monthly totals for the given months. Transfers are excluded. */
export function monthlySeries(state, months) {
  const byMonth = groupBy(state.transactions, (t) => monthKey(t.date));
  return months.map((m) => {
    const txs = byMonth.get(m) || [];
    const income = sum(txs.filter((t) => t.type === 'income'), (t) => t.amount);
    const expenses = sum(txs.filter((t) => t.type === 'expense'), (t) => t.amount);
    return { month: m, income, expenses, net: income - expenses, rate: income > 0 ? (income - expenses) / income : NaN, count: txs.length };
  });
}

export function incomeBySource(state, months) {
  const byMonth = groupBy(state.transactions.filter((t) => t.type === 'income'), (t) => monthKey(t.date));
  return months.map((m) => {
    const txs = byMonth.get(m) || [];
    const r = { month: m, me: 0, partner: 0, rental: 0, other: 0 };
    for (const t of txs) {
      if (t.categoryId === 'rental') r.rental += t.amount;
      else if (t.categoryId === 'salary' && t.owner === 'me') r.me += t.amount;
      else if (t.categoryId === 'salary' && t.owner === 'partner') r.partner += t.amount;
      else r.other += t.amount;
    }
    return r;
  });
}

export function expensesByCategory(state, months) {
  const set = new Set(months);
  const out = new Map();
  for (const t of state.transactions) {
    if (t.type !== 'expense' || !set.has(monthKey(t.date))) continue;
    out.set(t.categoryId, (out.get(t.categoryId) || 0) + t.amount);
  }
  return [...out.entries()].map(([categoryId, total]) => ({ categoryId, total })).sort((a, b) => b.total - a.total);
}

export function expensesByAccount(state, months) {
  const set = new Set(months);
  const out = new Map();
  for (const t of state.transactions) {
    if (t.type !== 'expense' || !set.has(monthKey(t.date))) continue;
    out.set(t.accountId, (out.get(t.accountId) || 0) + t.amount);
  }
  return out;
}

/** Of the given months, the ones that contain any transaction. */
export function monthsWithData(state, months) {
  const have = new Set(state.transactions.map((t) => monthKey(t.date)));
  return months.filter((m) => have.has(m));
}

/** Average spending per category over the months that actually have data. */
export function avgByCategory(state, months) {
  const used = monthsWithData(state, months);
  const n = Math.max(1, used.length);
  return new Map(expensesByCategory(state, used).map((x) => [x.categoryId, x.total / n]));
}

/** The latest month with data (or the current month). */
export function latestMonth(state) {
  const cur = monthKey(todayStr());
  let max = '';
  for (const t of state.transactions) if (t.date > max) max = t.date;
  const m = monthKey(max);
  return m && m < cur ? m : cur;
}

export function liquidBalance(state) {
  return sum(state.accounts.filter((a) => a.type === 'checking' || a.type === 'savings' || a.type === 'cash'), (a) => a.balance);
}

export function netWorth(state) {
  return sum(state.accounts, (a) => (a.type === 'credit' ? -Math.abs(a.balance) : a.balance));
}

/** Net worth history from account balance snapshots (carry the last known balance forward). */
export function netWorthHistory(state, months) {
  return months.map((m) => {
    let total = 0;
    let any = false;
    for (const a of state.accounts) {
      const snaps = (a.history || []).filter((h) => monthKey(h.date) <= m).sort((x, y) => (x.date < y.date ? -1 : 1));
      if (!snaps.length) continue;
      any = true;
      const v = snaps[snaps.length - 1].balance;
      total += a.type === 'credit' ? -Math.abs(v) : v;
    }
    return { month: m, value: any ? total : null };
  });
}

/** Months that are fully in the past and have data. */
export function completeMonths(state, n = 3) {
  const cur = monthKey(todayStr());
  const withData = new Set(state.transactions.map((t) => monthKey(t.date)));
  const out = [];
  let m = addMonths(cur, -1);
  for (let i = 0; i < 24 && out.length < n; i++, m = addMonths(m, -1)) if (withData.has(m)) out.push(m);
  return out;
}

/** Recurring payments (subscriptions etc.): same merchant in >= 2 different months with a similar amount. */
export function detectRecurringPayments(state) {
  const exp = state.transactions.filter((t) => t.type === 'expense');
  const groups = groupBy(exp, (t) => merchantKey(t.description));
  const out = [];
  for (const [key, txs] of groups) {
    if (!key || key.length < 3) continue;
    const months = new Set(txs.map((t) => monthKey(t.date)));
    if (months.size < 2) continue;
    const amounts = txs.map((t) => t.amount).sort((a, b) => a - b);
    const median = amounts[Math.floor(amounts.length / 2)];
    const similar = txs.filter((t) => Math.abs(t.amount - median) <= Math.max(1, median * 0.1));
    const simMonths = new Set(similar.map((t) => monthKey(t.date)));
    if (simMonths.size < 2 || similar.length / txs.length < 0.6) continue;
    out.push({ key, name: txs[txs.length - 1].description, monthly: median, months: simMonths.size, categoryId: txs[0].categoryId });
  }
  return out.sort((a, b) => b.monthly - a.monthly);
}

/** Budget status for the given month. */
export function budgetStatus(state, month) {
  const spent = new Map(expensesByCategory(state, [month]).map((x) => [x.categoryId, x.total]));
  return state.categories
    .filter((c) => c.kind === 'expense' && c.budget > 0)
    .map((c) => ({ category: c, budget: c.budget, spent: spent.get(c.id) || 0, ratio: (spent.get(c.id) || 0) / c.budget }))
    .sort((a, b) => b.ratio - a.ratio);
}

/** Future value of monthly contributions with monthly compounding. */
export function projectInvesting(monthly, years, annualRatePct, start = 0) {
  const r = annualRatePct / 100 / 12;
  const points = [];
  let value = start;
  let invested = start;
  for (let m = 1; m <= years * 12; m++) {
    value = value * (1 + r) + monthly;
    invested += monthly;
    if (m % 12 === 0) points.push({ year: m / 12, value, invested });
  }
  return points;
}

const SRC = {
  pension: { label: 'Wikifin – pensioensparen (FSMA)', url: 'https://www.wikifin.be/nl/belasting-werk-en-inkomen/belastingaangifte/belastingverminderingen/pensioensparen' },
  savingsTax: { label: 'KBC – tax on savings interest (2026: €1,020 tax-free)', url: 'https://www.kbcbrussels.be/retail/en/savings/savings-accounts/tax-on-earnings-from-savings.html' },
  vtest: { label: 'VREG V-test (compare energy contracts)', url: 'https://vtest.vreg.be' },
  telecom: { label: 'BIPT – compare telecom tariffs', url: 'https://www.bestetarief.be' },
  cgt: { label: 'KPMG – new Belgian capital gains tax (2026)', url: 'https://kpmg.com/be/en/insights/my-tax-compass/corporate-tax-insights/the-new-capital-gains-tax-on-financial-assets-in-belgium.html' },
  wikifinInvest: { label: 'Wikifin – investing basics', url: 'https://www.wikifin.be/nl/sparen-en-beleggen' },
};

/**
 * Build the list of suggestions. Each: {level: 'good'|'info'|'warn'|'alert', icon, title, text, saving?, source?}
 */
export function buildSuggestions(state) {
  const s = state.settings;
  const cats = catMap(state);
  const out = [];
  const recent = completeMonths(state, 3);
  if (!state.transactions.length) {
    out.push({ level: 'info', icon: '👋', title: 'Add your first data', text: 'Import screenshots, PDF statements or CSV exports, or add transactions by hand. Suggestions appear once there is at least one month of data.' });
    return out;
  }
  const months = recent.length ? recent : [latestMonth(state)];
  const series = monthlySeries(state, months);
  const avgIncome = sum(series, (x) => x.income) / series.length;
  const avgExp = sum(series, (x) => x.expenses) / series.length;
  const surplus = avgIncome - avgExp;
  const rate = avgIncome > 0 ? surplus / avgIncome : NaN;
  const target = (s.savingsTargetPct || 0) / 100;

  // 1. Savings rate
  if (avgIncome > 0) {
    if (rate >= target) {
      out.push({ level: 'good', icon: '🎯', title: `Savings rate ${(rate * 100).toFixed(0)}% – on target`, text: `Over the last ${series.length} month(s) you kept on average ${fmt(surplus)} per month. Your target is ${s.savingsTargetPct}%. Automate it: schedule a standing order to savings/investing the day after payday ("pay yourself first").` });
    } else {
      const gap = target * avgIncome - surplus;
      out.push({ level: rate < 0 ? 'alert' : 'warn', icon: rate < 0 ? '🚨' : '📉', title: `Savings rate ${(rate * 100).toFixed(0)}% – target ${s.savingsTargetPct}%`, text: `To reach your target you need to spend about ${fmt(gap)} less per month (or earn more). The suggestions below show where the money goes.`, saving: gap });
    }
  }

  // 2. Category spikes vs. average of earlier months
  const lm = latestMonth(state);
  const prev = lastMonths(addMonths(lm, -1), 3);
  const nowCats = new Map(expensesByCategory(state, [lm]).map((x) => [x.categoryId, x.total]));
  const prevCats = avgByCategory(state, prev);
  const hasPrev = monthsWithData(state, prev).length > 0;
  if (hasPrev) {
    for (const [cid, v] of nowCats) {
      const base = prevCats.get(cid) || 0;
      const c = cats.get(cid);
      if (!c || cid === 'taxes' || cid === 'housing') continue;
      if (v > 75 && v > base * 1.3 && v - base > 50) {
        out.push({ level: 'warn', icon: c.icon, title: `${c.name}: ${fmt(v)} this month`, text: `That is ${fmt(v - base)} more than your average of the previous ${monthsWithData(state, prev).length} month(s) (${fmt(base)}). Was it a one-off, or a new habit?`, saving: v - base });
      }
    }
  }

  // 3. Budgets
  for (const b of budgetStatus(state, lm)) {
    if (b.ratio >= 1) out.push({ level: 'alert', icon: b.category.icon, title: `Over budget: ${b.category.name}`, text: `${fmt(b.spent)} spent of ${fmt(b.budget)} (${(b.ratio * 100).toFixed(0)}%).`, saving: b.spent - b.budget });
    else if (b.ratio >= 0.85) out.push({ level: 'warn', icon: b.category.icon, title: `Almost at budget: ${b.category.name}`, text: `${fmt(b.spent)} of ${fmt(b.budget)} used.` });
  }

  // Averages per category over the recent months
  const avgCat = new Map(expensesByCategory(state, months).map((x) => [x.categoryId, x.total / months.length]));
  const A = (id) => avgCat.get(id) || 0;

  // 4. Subscriptions
  const subs = detectRecurringPayments(state).filter((r) => ['subscriptions', 'telecom', 'leisure', 'other-exp', 'shopping'].includes(r.categoryId));
  if (subs.length) {
    const total = sum(subs, (x) => x.monthly);
    out.push({ level: 'info', icon: '🔁', title: `${subs.length} recurring payment(s): ${fmt(total)}/month`, text: `Found: ${subs.slice(0, 6).map((x) => `${x.name} (${fmt(x.monthly)})`).join(', ')}${subs.length > 6 ? '…' : ''}. Cancel what you don't use every week, share family plans, or rotate streaming services (one at a time). Cutting a third saves ≈ ${fmt(total / 3)}/month.`, saving: total / 3 });
  }

  // 5. Eating out vs groceries
  const rest = A('restaurants');
  const groc = A('groceries');
  if (rest > 100 && rest > 0.35 * (rest + groc)) {
    out.push({ level: 'warn', icon: '🍽️', title: `Eating out: ${fmt(rest)}/month`, text: `That is ${((rest / (rest + groc)) * 100).toFixed(0)}% of your food budget. Cooking 1–2 extra evenings a week and limiting delivery apps (Deliveroo/Uber Eats add fees) could save ≈ ${fmt(rest * 0.3)}/month.`, saving: rest * 0.3 });
  }
  if (groc > 0) {
    out.push({ level: 'info', icon: '🛒', title: `Groceries: ${fmt(groc)}/month`, text: `Ideas: plan meals and shop with a list, compare per-kg prices, buy store brands (Boni, Everyday, 365), use the Colruyt/Delhaize/Lidl apps for discounts, and avoid small top-up shops. 10% less = ${fmt(groc * 0.1)}/month.`, saving: groc * 0.1 });
  }

  // 6. Bank fees and credit-card interest
  const feeTx = state.transactions.filter((t) => t.type === 'expense' && (t.categoryId === 'fees' || /debetrente|debetintrest|intrest|verwijlintrest|jaarbijdrage|beheerskost/.test(normalize(t.description))));
  if (feeTx.length) {
    const feeTotal = sum(feeTx.filter((t) => recent.includes(monthKey(t.date)) || monthKey(t.date) === lm), (t) => t.amount);
    const interest = feeTx.some((t) => /rente|intrest/.test(normalize(t.description)));
    out.push({ level: interest ? 'alert' : 'warn', icon: '🏦', title: interest ? 'You are paying credit/debit interest' : `Bank fees: ${fmt(feeTotal)} recently`, text: interest ? 'Credit-card (revolving) interest is one of the most expensive forms of debt. Pay the full Beobank statement balance every month (set a full-balance direct debit) and keep a cash buffer so the card is never used as a loan.' : 'Compare account packages: several Belgian banks offer free or cheaper current accounts. Check what you pay yearly for cards and packages, and drop unused cards.', saving: feeTotal / Math.max(1, recent.length) });
  }

  // 7. Energy / telecom / insurance yearly review
  if (A('utilities') > 0) out.push({ level: 'info', icon: '💡', title: `Energy & water: ${fmt(A('utilities'))}/month`, text: 'Compare your energy contract once a year with the VREG V-test (Flanders) – switching is free. Also check your advance payment (voorschot) matches real use, so you don\'t lend money interest-free.', source: SRC.vtest });
  if (A('telecom') > 60) out.push({ level: 'info', icon: '📱', title: `Phone & internet: ${fmt(A('telecom'))}/month`, text: 'Bundles often include things you don\'t use. Compare with the BIPT tariff simulator and ask your provider for a better deal or a cheaper plan (e.g. low-cost mobile operators).', source: SRC.telecom, saving: A('telecom') * 0.25 });
  if (A('insurance') > 0) out.push({ level: 'info', icon: '🛡️', title: `Insurance: ${fmt(A('insurance'))}/month`, text: 'Review policies yearly: car, fire/home, family liability, hospital. Ask 2–3 quotes, raise deductibles if you have a buffer, and drop overlapping cover (e.g. assistance already included in a bank package).' });
  if (A('car') > 250) out.push({ level: 'info', icon: '🚗', title: `Car & fuel: ${fmt(A('car'))}/month`, text: 'Look at fuel price apps, combine trips, check tyre pressure, and compare the true cost of a second car against public transport, cycling (fiscal bike allowance) or car sharing (Cambio/Poppy).', saving: A('car') * 0.1 });

  // 8. Many small purchases
  const smallTx = state.transactions.filter((t) => t.type === 'expense' && monthKey(t.date) === lm && t.amount < 15 && ['restaurants', 'shopping', 'other-exp', 'leisure'].includes(t.categoryId));
  if (smallTx.length >= 15) {
    const tot = sum(smallTx, (t) => t.amount);
    out.push({ level: 'info', icon: '☕', title: `${smallTx.length} small purchases (${fmt(tot)}) this month`, text: 'Small amounts add up. Try a weekly "fun money" amount on a separate card or a no-spend week each month.', saving: tot * 0.4 });
  }

  // 9. Cash buffer, then invest
  const liquid = liquidBalance(state);
  const emergency = avgExp * (s.emergencyMonths || 6);
  const hasBalances = state.accounts.some((a) => a.balanceDate);
  if (hasBalances && avgExp > 0) {
    if (liquid < emergency) {
      out.push({ level: 'warn', icon: '🧯', title: `Emergency fund: ${fmt(liquid)} of ${fmt(emergency)}`, text: `Aim for ${s.emergencyMonths} months of expenses on a savings account before investing. At your current surplus (${fmt(Math.max(0, surplus))}/month) you need about ${surplus > 0 ? Math.ceil((emergency - liquid) / surplus) : '∞'} month(s). On a regulated savings account interest is tax-free up to €1,020 per person (2026).`, source: SRC.savingsTax });
    } else {
      out.push({ level: 'good', icon: '🚀', title: `Buffer complete – ${fmt(liquid - emergency)} could be invested`, text: 'Your cash buffer covers your target. Money above it loses value to inflation on a current account. Consider a low-cost, diversified long-term plan (e.g. broad world index ETFs via a monthly plan). Only invest money you won\'t need for 5+ years. Since 2026 Belgium taxes capital gains on financial assets at 10% above an annual exemption of about €10,000 per person.', source: SRC.cgt });
    }
  }

  // 10. Pension savings
  out.push({ level: 'info', icon: '🧓', title: 'Pension savings (pensioensparen)', text: 'Each partner can get a tax reduction on pension savings: 30% on up to €1,050 or 25% on up to €1,350 per year (figures for tax year 2026). With two incomes that is up to €630 tax back per year combined at the €1,050 level. Prefer low-cost funds.', source: SRC.pension });

  // 11. Rental income reserve
  const rental = sum(state.transactions.filter((t) => t.categoryId === 'rental' && months.includes(monthKey(t.date))), (t) => t.amount) / months.length;
  if (rental > 0) out.push({ level: 'info', icon: '🏘️', title: `Rental income: ${fmt(rental)}/month`, text: 'Put a fixed part of the rent aside for maintenance, vacancy and property tax (onroerende voorheffing) so these bills don\'t hit your monthly budget. Track these costs under "Rental property costs" to see the real net return.' });

  // 12. Spending split by account
  const byAcc = expensesByAccount(state, months);
  if (byAcc.size > 1) {
    const am = accMap(state);
    const parts = [...byAcc.entries()].sort((a, b) => b[1] - a[1]).map(([id, v]) => `${am.get(id)?.name || 'Unknown'} ${fmt(v / months.length)}`);
    out.push({ level: 'info', icon: '💳', title: 'Spending per account (monthly average)', text: `${parts.join(' · ')}. Tip: pay shared costs from one joint account with a fixed monthly contribution from each partner; it makes overspending visible immediately.` });
  }

  const order = { alert: 0, warn: 1, good: 2, info: 3 };
  return out.sort((a, b) => order[a.level] - order[b.level] || (b.saving || 0) - (a.saving || 0));
}

let _money = (n) => `€${Math.round(n)}`;
export function setMoneyFormatter(f) {
  _money = f;
}
function fmt(n) {
  return _money(n);
}

export { SRC as SOURCES };
