// Your household finances for the Balance and Plan tabs: other assets (real estate, savings, pension…), loans,
// monthly income and costs, and the plan settings. Stored only on this device (and in backups).
// First-time defaults come from your earlier family-wealth dashboard (July 2026) and are marked so you check them.
import * as store from './store.js';
import { emit } from '../app.js';

const id = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
export const COST_CATS = ['Housing (rent, upkeep)', 'Utilities & energy', 'Food & groceries', 'Transport', 'Insurance', 'Children & education', 'Subscriptions & phone', 'Leisure, travel & eating out', 'Health', 'Taxes & fees', 'Other'];

const DEFAULTS = () => ({
  fromEarlier: true,
  assets: [
    { id: id(), type: 'realestate', name: 'Apartment', value: 370000, note: 'market value (earlier dashboard)' },
    { id: id(), type: 'cash', name: 'Savings / current accounts', value: 0, note: 'outside the broker' },
  ],
  loans: [{ id: id(), name: 'Mortgages (2 loans)', balance: 318821, rate: 0.025, payment: 1711.86, kind: 'mortgage', note: 'balance and payment from the earlier dashboard; check the rate' }],
  income: [
    { id: id(), name: 'Net salary', monthly: 0 },
    { id: id(), name: 'Rental income', monthly: 0 },
  ],
  costs: [{ id: id(), name: 'Living costs (all)', cat: 'Other', monthly: 2500 }],
  plan: {
    targets: [{ years: 10, value: 250000 }, { years: 20, value: 500000 }, { years: 30, value: 1000000 }],
    start: 100000, startMode: 'auto', monthly: 500, boost: false, ret: 0.06, vol: 0.15, infl: 0.02, preset: 'preserve', reserveMonths: 18, illiquidCap: 0.35,
    withdrawFrom: 30, marginRate: 0.06, other: { pe: 0, ra: 0, hf: 0, fi: 0 },
  },
});

export async function finance() {
  const f = await store.get('finance', null);
  if (f) return { ...DEFAULTS(), ...f, plan: { ...DEFAULTS().plan, ...(f.plan || {}) } };
  return DEFAULTS();
}
export async function saveFinance(f) { await store.set('finance', { ...f, fromEarlier: false }); emit('finance'); }
export const newId = id;

/** The portfolio as last calculated on the Portfolio tab: {stocks, cash (negative = margin), base, at}. */
export async function portfolioNow() { return store.get('fin.portfolio', null); }
/** Month-by-month history from the monthly holdings files: {ann, yrs, avgDep, months}. */
export async function portfolioHistory() { return store.get('fin.history', null); }

/** The whole balance sheet in one object. */
export function balanceSheet(f, pf) {
  // without the Portfolio tab's figures, the starting amount entered on the Plan tab counts as the portfolio
  const stocks = pf ? pf.stocks : (+f.plan.start || 0), brokerCash = pf ? pf.cash : 0, margin = brokerCash < 0 ? -brokerCash : 0;
  const sum = t => f.assets.filter(a => a.type === t).reduce((s, a) => s + (+a.value || 0), 0);
  const re = sum('realestate'), cash = sum('cash') + Math.max(0, brokerCash), pension = sum('pension'), other = sum('other');
  const mort = f.loans.filter(l => l.kind === 'mortgage').reduce((s, l) => s + (+l.balance || 0), 0), otherDebt = f.loans.filter(l => l.kind !== 'mortgage').reduce((s, l) => s + (+l.balance || 0), 0);
  const gross = stocks + cash + re + pension + other, debt = mort + otherDebt + margin;
  return { stocks, cash, re, pension, other, margin, mort, otherDebt, gross, debt, net: gross - debt, ltv: re ? mort / re : null };
}
/** Monthly cash flow: income, loan payments, living costs, margin interest and what is left. */
export function cashFlow(f, bs) {
  const inc = f.income.reduce((s, x) => s + (+x.monthly || 0), 0), loans = f.loans.reduce((s, l) => s + (+l.payment || 0), 0);
  const costs = f.costs.reduce((s, x) => s + (+x.monthly || 0), 0), marginInt = bs ? bs.margin * (f.plan.marginRate || 0) / 12 : 0;
  const out = loans + costs + marginInt;
  return { inc, loans, costs, marginInt, out, left: inc - out, rate: inc > 0 ? (inc - out) / inc : null };
}
