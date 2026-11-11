// Data model, defaults and merge logic (for syncing Mac <-> iPhone via backup files).
import { uid, nowIso } from './util.js';

export const ACCOUNT_TYPES = {
  checking: 'Current account',
  savings: 'Savings account',
  credit: 'Credit card',
  investment: 'Investments',
  cash: 'Cash',
};

export const OWNERS = { me: 'Me', partner: 'Partner', joint: 'Joint' };

// Reference palette (validated categorical order) – used for accounts & chart series.
export const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];

const C = (id, name, kind, icon, extra = {}) => ({ id, name, kind, icon, budget: 0, essential: false, ...extra });

export function defaultCategories() {
  return [
    // Expenses
    C('housing', 'Housing (rent / mortgage)', 'expense', '🏠', { essential: true }),
    C('utilities', 'Energy & water', 'expense', '💡', { essential: true }),
    C('groceries', 'Groceries', 'expense', '🛒', { essential: true }),
    C('restaurants', 'Restaurants & takeaway', 'expense', '🍽️'),
    C('transport', 'Public transport & taxi', 'expense', '🚆', { essential: true }),
    C('car', 'Car & fuel', 'expense', '🚗', { essential: true }),
    C('insurance', 'Insurance', 'expense', '🛡️', { essential: true }),
    C('health', 'Health & pharmacy', 'expense', '⚕️', { essential: true }),
    C('telecom', 'Phone & internet', 'expense', '📱', { essential: true }),
    C('subscriptions', 'Subscriptions & streaming', 'expense', '🔁'),
    C('shopping', 'Shopping', 'expense', '🛍️'),
    C('clothing', 'Clothing', 'expense', '👕'),
    C('kids', 'Kids & childcare', 'expense', '🧸', { essential: true }),
    C('leisure', 'Leisure & sport', 'expense', '🎾'),
    C('travel', 'Travel & holidays', 'expense', '✈️'),
    C('home', 'Home & garden', 'expense', '🪴'),
    C('personal', 'Personal care', 'expense', '💇'),
    C('gifts', 'Gifts & donations', 'expense', '🎁'),
    C('education', 'Education', 'expense', '📚'),
    C('pets', 'Pets', 'expense', '🐾'),
    C('taxes', 'Taxes', 'expense', '🏛️', { essential: true }),
    C('fees', 'Bank fees & interest', 'expense', '🏦'),
    C('property', 'Rental property costs', 'expense', '🔧', { essential: true }),
    C('cash', 'Cash withdrawal', 'expense', '💶'),
    C('other-exp', 'Other expenses', 'expense', '📦'),
    // Income
    C('salary', 'Salary', 'income', '💼'),
    C('rental', 'Rental income', 'income', '🏘️'),
    C('benefits', 'Benefits & child allowance', 'income', '👶'),
    C('refunds', 'Refunds & reimbursements', 'income', '↩️'),
    C('interest', 'Interest & dividends', 'income', '📈'),
    C('other-inc', 'Other income', 'income', '➕'),
    // Transfers (not counted as income or expense)
    C('transfer', 'Transfer between own accounts', 'transfer', '🔄'),
    C('card-payment', 'Credit card repayment', 'transfer', '💳'),
    C('to-savings', 'Moved to savings / investing', 'transfer', '🐷'),
  ];
}

export function defaultAccounts() {
  const t = nowIso();
  return [
    { id: 'belfius', name: 'Belfius', bank: 'Belfius', type: 'checking', owner: 'me', color: PALETTE[0], balance: 0, balanceDate: '', history: [], updatedAt: t },
    { id: 'kbc', name: 'KBC', bank: 'KBC', type: 'checking', owner: 'partner', color: PALETTE[1], balance: 0, balanceDate: '', history: [], updatedAt: t },
    { id: 'beobank', name: 'Beobank Mastercard', bank: 'Beobank', type: 'credit', owner: 'me', color: PALETTE[2], balance: 0, balanceDate: '', history: [], updatedAt: t },
    { id: 'cash', name: 'Cash', bank: '', type: 'cash', owner: 'joint', color: PALETTE[3], balance: 0, balanceDate: '', history: [], updatedAt: t },
  ];
}

export function defaultRecurring() {
  const t = nowIso();
  return [
    { id: uid(), name: 'Salary – Me', type: 'income', amount: 0, categoryId: 'salary', accountId: 'belfius', owner: 'me', day: 25, active: true, updatedAt: t },
    { id: uid(), name: 'Salary – Partner', type: 'income', amount: 0, categoryId: 'salary', accountId: 'kbc', owner: 'partner', day: 25, active: true, updatedAt: t },
    { id: uid(), name: 'Rental income', type: 'income', amount: 0, categoryId: 'rental', accountId: 'belfius', owner: 'joint', day: 1, active: true, updatedAt: t },
  ];
}

export function initialState() {
  return {
    version: 1,
    settings: {
      currency: 'EUR',
      locale: 'en-IE',
      meName: 'Me',
      partnerName: 'Partner',
      savingsTargetPct: 30,
      emergencyMonths: 6,
      expectedReturnPct: 5,
      autoLockMin: 5,
      theme: 'auto',
      lastBackupAt: '',
    },
    accounts: defaultAccounts(),
    categories: defaultCategories(),
    transactions: [],
    recurring: defaultRecurring(),
    rules: [], // learned: { id, pattern, categoryId, type }
    goals: [],
    deleted: {}, // tombstones for sync: { [id]: isoDate }
  };
}

/** Bring older/partial states up to date. */
export function migrate(state) {
  const base = initialState();
  const s = { ...base, ...state, settings: { ...base.settings, ...(state.settings || {}) } };
  // make sure all default categories exist (new ones added in later versions)
  const have = new Set(s.categories.map((c) => c.id));
  for (const c of base.categories) if (!have.has(c.id)) s.categories.push(c);
  for (const k of ['transactions', 'recurring', 'rules', 'goals', 'accounts']) if (!Array.isArray(s[k])) s[k] = [];
  if (!s.deleted) s.deleted = {};
  return s;
}

export function ownerName(state, owner) {
  if (owner === 'me') return state.settings.meName || 'Me';
  if (owner === 'partner') return state.settings.partnerName || 'Partner';
  return 'Joint';
}

/**
 * Merge another copy of the data (e.g. a backup from the other device) into this one.
 * Items are matched by id; the most recently updated copy wins; deletions propagate.
 */
export function mergeStates(local, incoming) {
  const out = migrate(structuredClone(local));
  const inc = migrate(incoming);
  const deleted = { ...inc.deleted, ...out.deleted };
  for (const [id, t] of Object.entries(inc.deleted)) if (!out.deleted[id] || out.deleted[id] < t) deleted[id] = t;
  out.deleted = deleted;

  for (const key of ['transactions', 'accounts', 'recurring', 'rules', 'goals', 'categories']) {
    const map = new Map(out[key].map((x) => [x.id, x]));
    for (const item of inc[key]) {
      const mine = map.get(item.id);
      if (!mine || (item.updatedAt || '') > (mine.updatedAt || '')) map.set(item.id, item);
    }
    out[key] = [...map.values()].filter((x) => !deleted[x.id]);
  }
  return out;
}
