// The trade plan turned into concrete DEGIRO orders. DEGIRO offers Market, Limit, Stop Loss, Stop Limit and (on some
// exchanges only) Trailing Stop orders, valid for the day or until cancelled ("GTC"). It has no orders that cancel each
// other (OCO), so the list says when to place, change or cancel each order. Pure function: no network, no storage.
const r2 = x => Math.round(x * 100) / 100;

/**
 * T = tradePlan(plan, pivot, fx); P = the plan settings ({add2, add3, zone}). Returns [{step, when, side, type, shares,
 * stop, limit, valid, why}] in the order you place them.
 */
export function degiroOrders(T, pivot, P, close = null) {
  const [b1, b2, b3] = T.buys, zoneTop = T.zoneTop, held = (k) => T.buys.slice(0, k).reduce((s, b) => s + b.shares, 0);
  const lim = (from, cap) => r2(Math.min(from, zoneTop)); // never pay above the buy zone (+5%)
  const out = [];
  const inZone = close != null && close >= pivot && close <= zoneTop, extended = close != null && close > zoneTop;
  if (extended) out.push({
    step: 'No buy', when: `Now: the price ${r2(close)} is above the buy zone (${r2(zoneTop)})`, side: 'Buy', type: '— (no order)', shares: 0, stop: null, limit: null, valid: 'Day',
    why: 'Extended: don\'t chase. Wait for a pullback to the 50-day line or a new base; the plan below applies to a new buy point.',
  });
  else if (inZone && b1 && b1.shares) out.push({
    step: 'Buy 1', when: `Now: the price ${r2(close)} is inside the buy zone`, side: 'Buy', type: 'Limit', shares: b1.shares,
    stop: null, limit: r2(Math.min(close * 1.005, zoneTop)), valid: 'Day',
    why: `A day order a little above the last price (never above ${r2(zoneTop)}). Only if the breakout came on volume ≥ 1.4× the 50-day average; otherwise start with half.`,
  });
  if (!inZone && !extended && b1 && b1.shares) out.push({
    step: 'Buy 1', when: 'Before the breakout, while the price is still below the buy point', side: 'Buy', type: 'Stop Limit', shares: b1.shares,
    stop: r2(pivot), limit: lim(pivot * (1 + P.add2[1]), zoneTop), valid: 'GTC',
    why: `Fills only once the price trades at the buy point ${r2(pivot)} and never above ${lim(pivot * (1 + P.add2[1]))}, so you don't chase. DEGIRO cannot check volume: if the breakout day closes on weak volume (under 1.4× the 50-day average) or back below the buy point, consider selling half.`,
  });
  out.push({
    step: 'Protect', when: 'Right after Buy 1 is filled', side: 'Sell', type: 'Stop Loss', shares: b1 ? b1.shares : 0, stop: T.stop, limit: null, valid: 'GTC',
    why: `Your ${Math.round((1 - T.stop / T.avg) * 100)}% stop. A Stop Loss (not Stop Limit) because it always sells: after a gap down a Stop Limit can stay unfilled while the price keeps falling.`,
  });
  if (b2 && b2.shares) out.push({
    step: 'Buy 2', when: 'Once Buy 1 holds above the buy point', side: 'Buy', type: 'Stop Limit', shares: b2.shares,
    stop: r2(pivot * (1 + P.add2[0])), limit: lim(pivot * (1 + P.add2[1])), valid: 'GTC',
    why: 'The add at +1–2%. After it fills: change the Stop Loss to ' + held(2) + ' shares.',
  });
  if (b3 && b3.shares) out.push({
    step: 'Buy 3', when: 'Once Buy 2 is filled', side: 'Buy', type: 'Stop Limit', shares: b3.shares,
    stop: r2(pivot * (1 + P.add3[0])), limit: r2(zoneTop), valid: 'GTC',
    why: `The last add at +4–5%. After it fills: change the Stop Loss to ${T.shares} shares (stop ${T.stop}). Cancel any buy order still open once the price is above ${r2(zoneTop)} (extended).`,
  });
  out.push({
    step: 'Raise stop', when: `When the price reaches ${T.raise15.price} (+15%)`, side: 'Sell', type: 'Stop Loss (change)', shares: T.shares, stop: T.raise15.to, limit: null, valid: 'GTC',
    why: `Change the existing Stop Loss to ${T.raise15.to}, just under the buy point. At ${T.raise20.price} (+20%) change it again to ${T.raise20.to} (breakeven).`,
  });
  T.sells.forEach((s, i) => out.push({
    step: `Take profit ${i + 1}`, when: `When the price nears ${s.price} (within ~3%)`, side: 'Sell', type: 'Limit', shares: s.shares, stop: null, limit: s.price, valid: 'GTC',
    why: `Sell ${s.shares} shares at +${Math.round(s.gain * 100)}%. DEGIRO has no orders that cancel each other, and it may not accept sell orders for more shares than you hold: first lower the Stop Loss by ${s.shares} shares, then place this Limit. Skip it if the 8-week rule applies (+20% within 3 weeks of the breakout).`,
  }));
  out.push({
    step: 'The rest', when: 'Each evening while you hold it', side: 'Sell', type: 'Market or Limit (by hand)', shares: T.runner.shares, stop: null, limit: null, valid: 'Day',
    why: 'Sell the last part on a heavy-volume close below the 50-day line or a climax top. No DEGIRO order watches the 50-day line: the app checks it every evening and alerts you. A Trailing Stop exists on some DEGIRO exchanges only and follows the price, not the 50-day line.',
  });
  return out;
}
