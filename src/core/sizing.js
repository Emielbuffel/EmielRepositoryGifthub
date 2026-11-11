// Position sizing from the account itself: your own money (stocks at today's prices + cash; negative cash = margin
// loan) sets the size of a position (e.g. 20%), and the market direction sets how much you may have invested:
// - confirmed uptrend: up to 100%, plus margin up to your limit (e.g. 50% of your own money → 150% invested);
// - uptrend under pressure: 40–60%, no margin;  - correction: 0–20%, no margin (pay the loan back).
// The number of positions follows from that (150% ÷ 20% = 7; 100% ÷ 20% = 5) instead of a fixed number.
// Margin multiplies gains and losses: with 150% invested a 10% fall in your stocks costs 15% of your own money.
// Pure functions.

/** Highest share of your own money that may be invested now, per market status ('up' | 'press' | 'corr'). */
export function allowedExposure(market, maxMargin = 0.5) {
  if (market === 'corr') return 0.2;
  if (market === 'press') return 0.6;
  return 1 + Math.max(0, maxMargin); // confirmed uptrend (or unknown): fully invested plus the margin limit
}

/**
 * acct: {stocks, cash} in the plan currency (cash < 0 = margin loan). S: {posPct, maxMargin}. market: 'up'|'press'|'corr'|null.
 * Returns everything the app shows about size, room and margin.
 */
export function sizing(acct, S, market = 'up') {
  const stocks = Math.max(0, acct.stocks || 0), cash = acct.cash || 0, equity = stocks + cash;
  const posPct = S.posPct || 0.2, maxMargin = S.maxMargin ?? 0.5;
  const allowed = allowedExposure(market, maxMargin), noMarginAllowed = allowedExposure('up', 0);
  const position = Math.max(0, equity * posPct);
  const exposure = equity > 0 ? stocks / equity : null;
  const loan = Math.max(0, -cash), marginPct = equity > 0 ? loan / equity : null;
  const maxPositions = Math.max(1, Math.floor(allowed / posPct + 1e-9)), fullNoMargin = Math.floor(noMarginAllowed / posPct + 1e-9);
  const room = Math.max(0, allowed * equity - stocks);           // money you may still put to work now
  const cashFree = Math.max(0, cash), marginRoom = Math.max(0, Math.min(room, (market === 'up' || !market ? maxMargin : 0) * equity - loan) - cashFree);
  const notes = [];
  if (equity <= 0) notes.push(['bad', 'Your own money is zero or negative: the margin loan is larger than your stocks.']);
  if (marginPct != null && marginPct > maxMargin + 1e-9) notes.push(['bad', `Margin is ${Math.round(marginPct * 100)}% of your own money, above your ${Math.round(maxMargin * 100)}% limit: sell or add cash to bring it down.`]);
  if (loan > 0 && market && market !== 'up') notes.push(['bad', `You use margin (${Math.round(marginPct * 100)}%) while the market is ${market === 'corr' ? 'in a correction' : 'under pressure'}: the book uses margin only in a bull market — pay it back first by selling your weakest stocks.`]);
  if (exposure != null && exposure > allowed + 0.05) notes.push(['warn', `You are ${Math.round(exposure * 100)}% invested; the market status allows about ${Math.round(allowed * 100)}% now.`]);
  return { stocks, cash, equity, position, exposure, allowed, maxPositions, fullNoMargin, room, cashFree, loan, marginPct, marginRoom, maxMargin, posPct, market: market || 'up', notes,
    // how a fall in your stocks hits your own money at today's exposure, and at the full margin limit
    leverageNow: exposure || 0, leverageMax: 1 + maxMargin };
}

/** How one new position would be paid: from cash first, then margin (if the market allows). */
export function fundTrade(sz, amount) {
  const fromCash = Math.min(amount, sz.cashFree), fromMargin = Math.min(amount - fromCash, sz.marginRoom);
  const short = Math.max(0, amount - fromCash - fromMargin);
  const loanAfter = sz.loan + fromMargin;
  return { fromCash, fromMargin, short, marginAfter: sz.equity > 0 ? loanAfter / sz.equity : null, ok: short < 1 };
}
