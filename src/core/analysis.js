// Turns a detector scan into the base card, live signal, checklist, flags and key numbers.
// Pure functions: no DOM. `fp` formats a price in the listing currency.
import { calc, weekly, rsNewHigh } from './indicators.js';

export const pc = (x, d = 1) => x == null || !isFinite(x) ? '—' : (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(d) + '%';
export const f2 = x => x == null || !isFinite(x) ? '—' : x.toFixed(2);
export const fmtVol = v => {
  if (v == null || !isFinite(v)) return '—'; const a = Math.abs(v);
  return a >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : a >= 1e6 ? (v / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M' : a >= 1e3 ? (v / 1e3).toFixed(a >= 1e5 ? 0 : 1) + 'K' : String(Math.round(v));
};
export const fD = t => new Date(t * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
export const fDs = t => new Date(t * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' });

/** The state the stock is in relative to its current or most recent base. */
export function baseState(R, d) {
  const n = d.length - 1, c = d[n].close;
  const last = R.last, active = last && !last.failed && n - last.bo <= 40 ? last : null;
  const cur = R.cur.filter(p => p.pivot), desc = R.cur.find(p => p.type === 'desc');
  if (cur.length) {
    const p = cur[0], dist = c / p.pivot - 1;
    return { st: dist >= -0.05 ? 'NEAR BUY POINT' : 'BASE FORMING', tone: dist >= -0.05 ? 'ok' : 'warn', p, dist, alts: cur.slice(1) };
  }
  if (active) {
    const g = c / active.pivot - 1;
    const st = g < -0.08 ? 'STOP HIT' : g < 0 ? 'BELOW BUY POINT' : g <= 0.05 ? 'IN BUY ZONE' : 'EXTENDED';
    return { st, tone: g < -0.08 ? 'bad' : g < 0 ? 'warn' : g <= 0.05 ? 'ok' : 'warn', p: active, dist: g, bo: true, alts: [] };
  }
  if (desc) return { st: 'FAULTY BASE', tone: 'bad', p: desc, alts: [] };
  if (R.sinceHigh < 25 && R.extended != null && R.extended > 0)
    return { st: 'NO BASE YET', tone: 'mute', p: null, alts: [], msg: `At or near new highs and ${pc(R.extended)} above the 50-day line. No base has formed since the last breakout. Wait for a 5-week+ consolidation.` };
  return { st: 'NO BASE', tone: 'mute', p: null, alts: [], msg: "No sound base right now. The stock is not near a buy point." };
}

/** Facts, plan and notes for the base card. */
export function baseCard(R, d, bench, fp) {
  const B = baseState(R, d), n = d.length - 1, P = R.P;
  const out = { B, title: '', facts: [], plan: [], notes: [], also: '' };
  if (!B.p) { out.also = B.msg; return out; }
  const p = B.p;
  out.title = p.name + (B.bo ? ' · broke out ' + fD(d[p.bo].time) : '');
  out.facts.push(['Length', p.weeks ? Math.round(p.weeks) + ' wk' : '—'], ['Depth', p.depth != null ? '−' + Math.round(p.depth * 100) + '%' : '—'], ['Stage', p.stage ? String(p.stage) : '—']);
  if (p.pivot) out.facts.push(['Buy point', fp(p.pivot)], [B.bo ? 'vs buy point' : 'Distance', pc(B.dist)]);
  if (p.type === 'cwh') out.facts.push(['Handle', '−' + Math.round(p.hd * 100) + '% · ' + (p.handleWeeks < 1 ? Math.round(p.handleWeeks * 5) + ' days' : Math.round(p.handleWeeks) + ' wk')]);
  if (p.pivot) {
    const need = (P.av[n] || 0) * 1.4;
    if (!B.bo) {
      out.plan.push(`Buy only on a close above <b>${fp(p.pivot)}</b> with volume of at least <b>${fmtVol(need)}</b> shares (40% above the 50-day average).`);
      out.plan.push(`Buy zone: ${fp(p.pivot)} to ${fp(p.pivot * 1.05)}. Above that the stock is extended; don't chase it.`);
    } else {
      out.plan.push(`Breakout-day volume was ${p.volRatio ? pc(p.volRatio - 1, 0) : '—'} vs average ${p.volRatio >= 1.4 ? '(confirmed)' : "(below the +40% a confirmed breakout needs)"}.`);
      out.plan.push(B.dist > 0.05 ? `Now ${pc(B.dist)} above the buy point: past the 5% buy zone. Don't add here; wait for a pullback or a new base.`
        : B.dist >= 0 ? `Inside the buy zone (${fp(p.pivot)}–${fp(p.pivot * 1.05)}).`
          : `Back under the buy point. A close below ${fp(p.pivot * 0.98)} would count as a failed breakout.`);
    }
    out.plan.push(`Stop: sell if it falls 7–8% below your purchase price (≈ ${fp(p.pivot * 0.92)} if bought at the buy point).`);
    out.plan.push(`Profits: take most at +20–25% (${fp(p.pivot * 1.2)}–${fp(p.pivot * 1.25)}). A stock that gains 20% within 3 weeks of the breakout is often held for at least 8 weeks.`);
  }
  if (p.faulty) out.plan.unshift("<b>Faulty base</b> by the classic rules (see the red notes). Breakouts from faulty bases fail more often: smaller position, tighter stop.");
  (p.notes || []).forEach(x => out.notes.push(x));
  if (p.stage >= 3) out.notes.push(['warn', `Stage ${p.stage} base: late-stage bases fail more often (stage 1–2 work best)`]);
  if (bench && bench.length) {
    const rsHi = rsNewHigh(calc(d, false, bench).rs, 252);
    out.notes.push(rsHi ? ['good', 'RS line at a 52-week high (leadership)'] : ['warn', 'RS line is not at a new high']);
  }
  out.also = B.alts.length ? 'Also fits: ' + B.alts.map(a => a.name + ' (buy point ' + fp(a.pivot) + ')').join(', ') + '.' : '';
  return out;
}

/**
 * Live signal (BUY / HOLD / SELL), the checklist, flags and key numbers.
 * mkt = { us: 'up'|'press'|'corr', usLabel } or null. drawings = the user's drawings for this stock.
 */
export function signal(R, d, bench, fp, mkt, drawings = []) {
  const k = calc(d, false, bench), n = d.length - 1, c = k.c[n];
  const w = weekly(d), kw = calc(w, true, bench), m = w.length - 1;
  const B = baseState(R, d);
  const hi52 = Math.max(...d.slice(Math.max(0, n - 252), n + 1).map(x => x.high)), lo52 = Math.min(...d.slice(Math.max(0, n - 252), n + 1).map(x => x.low));
  const avPrev = R.P.av[n], volR = avPrev ? k.v[n] / avPrev : null;
  const vol10 = k.v50[n] ? k.v.slice(n - 9).reduce((a, b) => a + b, 0) / 10 / k.v50[n] : null;
  const s200up = k.s200[n] != null && k.s200[n - 20] != null && k.s200[n] > k.s200[n - 20], s50up = k.s50[n] > k.s50[n - 10];
  const macdUp = k.macd.m[n] > k.macd.sg[n], r = k.rsi[n];
  const hasRs = k.rs[n] != null, rsHi = hasRs && rsNewHigh(k.rs, 252);
  let upV = 0, dnV = 0;
  for (let i = Math.max(1, n - 49); i <= n; i++) { if (d[i].close >= d[i - 1].close) upV += d[i].volume; else dnV += d[i].volume; }
  const udr = dnV ? upV / dnV : null;
  const inBase = B.p && B.p.pivot && !B.bo, bo = B.bo ? B.p : null;
  let rsMax = -Infinity; for (let i = Math.max(0, n - 252); i <= n; i++) if (k.rs[i] != null) rsMax = Math.max(rsMax, k.rs[i]);
  const rsNear = hasRs && k.rs[n] >= rsMax * 0.95;

  const steps = [
    ['Price above the 200-day line', k.s200[n] != null && c > k.s200[n], `${f2(c)} vs ${f2(k.s200[n])}`],
    ['200-day line rising', s200up, ''],
    ['Price above the 50-day line', c > k.s50[n], f2(k.s50[n])],
    ['In a sound base or a fresh breakout', !!(B.p && B.p.pivot && !B.p.faulty), B.p ? B.p.name : 'none'],
    ['Within 5% of the buy point', B.p && B.p.pivot ? (B.dist >= -0.05 && B.dist <= 0.05) : false, B.p && B.p.pivot ? pc(B.dist) : ''],
    [bo ? 'Breakout volume at least +40%' : 'Volume drying up in the base', bo ? bo.volRatio >= 1.4 : vol10 != null && vol10 < 1, bo ? (bo.volRatio ? '×' + bo.volRatio.toFixed(2) : '') : vol10 != null ? '10-day ×' + vol10.toFixed(2) : ''],
    ['RS line at a new 52-week high', rsHi, hasRs ? '' : 'no benchmark'],
    ['Up/down volume ratio above 1', udr != null && udr > 1, udr ? udr.toFixed(2) : ''],
    ['Early-stage base (stage 1–2)', B.p && B.p.stage ? B.p.stage <= 2 : false, B.p && B.p.stage ? 'stage ' + B.p.stage : ''],
    ['Daily MACD above its signal', macdUp, ''],
    ['Market in a confirmed uptrend (M)', !!(mkt && mkt.us === 'up'), mkt ? mkt.usLabel : 'see the Market tab'],
  ];

  let sig, why;
  if (k.s200[n] != null && c < k.s200[n]) { sig = 'SELL'; why = 'Closed below the 200-day line: the long uptrend is broken.'; }
  else if (bo && c < bo.pivot * 0.92) { sig = 'SELL'; why = "More than 8% below the breakout buy point: the 7–8% loss-cutting rule says sell."; }
  else if (bo && B.dist >= 0 && B.dist <= 0.05 && bo.volRatio >= 1.4 && c > k.s50[n]) { sig = 'BUY'; why = `In the buy zone of a volume-confirmed ${bo.name.toLowerCase()} breakout. Stop about ${fp(bo.pivot * 0.92)}.`; }
  else if (bo && B.dist > 0.05) { sig = 'HOLD'; why = "Extended beyond the 5% buy zone. Hold if you own it; don't chase it."; }
  else if (bo && B.dist >= 0) { sig = 'HOLD'; why = "Broke out, but volume was below the +40% a confirmed breakout needs. Wait for confirmation."; }
  else if (inBase) { sig = 'WATCH'; why = `${(Math.abs(B.dist) * 100).toFixed(1)}% ${B.dist < 0 ? 'below' : 'above'} the ${B.p.name.toLowerCase()} buy point (${fp(B.p.pivot)}). Buy only on a volume breakout.`; }
  else if (c < k.s50[n] && !s50up && !macdUp) { sig = 'SELL'; why = 'Below a falling 50-day line with weak momentum. Trim or tighten stops.'; }
  else { sig = 'HOLD'; why = B.msg || 'No buy setup right now.'; }
  if (sig === 'BUY' && mkt && mkt.us === 'corr') { sig = 'WATCH'; why = "The setup is valid, but the market is in a correction. Most stocks follow the market, so wait for a follow-through day."; }

  // flags
  const F = [], add = (l, t) => F.push([l, t]);
  const cross = (a, b2, look) => {
    for (let i = n; i > n - look && i > 0; i--) {
      if (a[i] == null || b2[i] == null || a[i - 1] == null || b2[i - 1] == null) continue;
      if (a[i] > b2[i] && a[i - 1] <= b2[i - 1]) return ['up', n - i];
      if (a[i] < b2[i] && a[i - 1] >= b2[i - 1]) return ['down', n - i];
    }
    return null;
  };
  const ago = x => x ? x + (x === 1 ? ' session ago' : ' sessions ago') : 'today';
  if (B.bo && n - B.p.bo <= 2) add(B.p.volRatio >= 1.4 ? 'bull' : 'warn', `Broke out of a ${B.p.name.toLowerCase()} ${ago(n - B.p.bo)} on volume ${pc(B.p.volRatio - 1, 0)} vs average.`);
  if (B.p && B.p.pivot && !B.bo && B.dist >= -0.03) add('info', `Within ${(Math.abs(B.dist) * 100).toFixed(1)}% of the buy point ${fp(B.p.pivot)}.`);
  if (R.last && R.last.failed && n - R.last.failed <= 10) add('bear', `Failed breakout: closed back under the ${fp(R.last.pivot)} buy point ${ago(n - R.last.failed)}.`);
  if (rsHi) add('bull', c >= hi52 * 0.995 ? 'RS line at a new high together with price.' : "RS line at a new high before price: a classic sign of leadership.");
  let x = cross(k.s50, k.s200, 15); if (x) add(x[0] === 'up' ? 'bull' : 'bear', `${x[0] === 'up' ? 'Golden' : 'Death'} cross (50-day ${x[0] === 'up' ? 'above' : 'below'} 200-day) ${ago(x[1])}.`);
  x = cross(k.c, k.s50, 5); if (x) add(x[0] === 'up' ? 'bull' : 'bear', `Price crossed ${x[0] === 'up' ? 'above' : 'below'} the 50-day line ${ago(x[1])}${volR >= 1.4 && x[1] === 0 ? ' on heavy volume' : ''}.`);
  x = cross(k.macd.m, k.macd.sg, 5); if (x) add(x[0] === 'up' ? 'bull' : 'bear', `Daily MACD crossed ${x[0] === 'up' ? 'above' : 'below'} its signal ${ago(x[1])}.`);
  if (r > 70) add('warn', `RSI ${f2(r)}: overbought, pullback risk.`); else if (r < 30) add('warn', `RSI ${f2(r)}: oversold.`);
  if (k.s50[n] && c / k.s50[n] - 1 > 0.25) add('warn', `${pc(c / k.s50[n] - 1, 0)} above the 50-day line: very extended.`);
  if (volR != null && volR >= 1.5) add(c >= d[n - 1].close ? 'bull' : 'bear', `Volume ${pc(volR - 1, 0)} vs average on an ${c >= d[n - 1].close ? 'up' : 'down'} day (${c >= d[n - 1].close ? 'accumulation' : 'distribution'}).`);
  if (vol10 != null && vol10 < 0.8) add('info', `Volume drying up: last 10 days ×${vol10.toFixed(2)} of the 50-day average.`);
  const bwNow = k.bw[n], bwH = k.bw.slice(Math.max(0, n - 125), n + 1).filter(v => v != null).sort((a, b) => a - b);
  if (bwH.length > 50 && bwNow <= bwH[Math.floor(bwH.length * 0.2)]) add('info', 'Bollinger squeeze: bands among the tightest of the last 6 months.');
  const lt = d[n].time, pt = d[n - 1].time, pcl = d[n - 1].close;
  for (const dr of drawings) {
    if (dr.type === 'cup' && dr.pts && dr.pts.length >= 3) {
      const piv = cupPivot(dr);
      if (c > piv && pcl <= piv) add('bull', `Closed above your cup's buy point (${f2(piv)}). Check volume: a confirmed breakout needs 40%+ above average.`);
      else if (c < piv && c >= piv * 0.95) add('info', `Within 5% below your cup's buy point (${f2(piv)}).`);
      else if (c > piv && c <= piv * 1.05) add('info', `In the buy zone of your cup (${f2(piv)}–${f2(piv * 1.05)}).`);
      continue;
    }
    const nm = dr.type === 'trend' ? 'your trend line' : dr.type === 'hline' ? 'your level' : dr.type === 'zone' ? 'your zone' : null; if (!nm) continue;
    if (dr.type === 'trend') {
      const v = lineVal(dr, lt), vp = lineVal(dr, pt);
      if (c < v && pcl >= vp) add('bear', `Closed below ${nm} (${f2(v)}).`);
      else if (c > v && pcl <= vp) add('bull', `Closed above ${nm} (${f2(v)}).`);
      else if (Math.abs(c - v) / c < 0.015) add('info', `Within 1.5% of ${nm} (${f2(v)}).`);
    } else {
      const top = Math.max(dr.p1, dr.p2 ?? dr.p1), bot = Math.min(dr.p1, dr.p2 ?? dr.p1);
      if (c > top && pcl <= top) add('bull', `Broke above ${nm} (${f2(top)}).`);
      else if (c < bot && pcl >= bot) add('bear', `Broke below ${nm} (${f2(bot)}).`);
      else if (c >= bot * 0.99 && c <= top * 1.01) add('info', `Price is at ${nm}.`);
    }
  }
  if (!F.length) add('info', 'Nothing new today.');

  const nums = [
    ['Last close', fp(c)],
    ['50-day / 200-day line', f2(k.s50[n]) + ' / ' + f2(k.s200[n])],
    ['10-week / 40-week line', f2(kw.l3[m]) + ' / ' + f2(kw.l4[m])],
    ['52-week high / low', f2(hi52) + ' / ' + f2(lo52)],
    ['Off 52-week high', pc(c / hi52 - 1)],
    ['Volume vs 50-day avg', volR ? '×' + volR.toFixed(2) : '—'],
    ['Up/down volume (50 days)', udr ? udr.toFixed(2) : '—'],
    ['RSI 14 (daily / weekly)', f2(r) + ' / ' + f2(kw.rsi[m])],
    ['ATR 14', f2(k.atr[n]) + ' (' + (k.atr[n] / c * 100).toFixed(1) + '%)'],
    ['Data through', fD(d[n].time)],
  ];

  // growth-checklist items that can be judged from prices alone
  const nState = ['NEAR BUY POINT', 'IN BUY ZONE'].includes(B.st) || c >= hi52 * 0.99 ? 'pass' : ['FAULTY BASE', 'STOP HIT'].includes(B.st) ? 'fail' : c >= hi52 * 0.85 ? 'mid' : 'fail';
  const canslim = {
    N: [nState, (B.p ? B.p.name + ': ' : '') + B.st.toLowerCase() + '. ' + pc(c / hi52 - 1) + ' vs the 52-week high.'],
    S: [udr == null ? 'na' : udr > 1.2 ? 'pass' : udr > 1 ? 'mid' : 'fail', udr == null ? 'No volume data.' : `Up/down volume ratio ${udr.toFixed(2)} over 50 days (above 1 = accumulation).`],
    L: [!hasRs ? 'na' : rsHi ? 'pass' : rsNear ? 'mid' : 'fail', !hasRs ? 'No benchmark loaded for the RS line.' : rsHi ? 'RS line at a new 52-week high.' : rsNear ? 'RS line within 5% of its 52-week high.' : 'RS line well below its high: not a leader right now.'],
    M: [!mkt ? 'na' : mkt.us === 'up' ? 'pass' : mkt.us === 'press' ? 'mid' : 'fail', mkt ? mkt.usLabel + '.' : 'Open the Market tab to load the market status.'],
  };
  return { B, sig, why, steps, flags: F, nums, canslim };
}

export const lineVal = (d, t) => d.p1 + (d.p2 - d.p1) * (t - d.t1) / (d.t2 - d.t1);
export function cupPivot(dr) {
  const [a, , r] = dr.pts; const H = Math.max(a[1], r[1]);
  return (dr.pts.length >= 4 ? Math.max(r[1], ...dr.pts.slice(3).map(x => x[1])) : H) + 0.10;
}

/** Summary row for one stock (used by the screener and the portfolio). Port of scripts/screener.js. */
export function screenRow(sym, name, bars, R, bench, { noVol = false } = {}) {
  const b = bars, n = b.length - 1; if (n < 119) return null;
  const c = b.map(x => x.close), v = b.map(x => x.volume);
  const ch = k => n - k >= 0 ? c[n] / c[n - k] - 1 : null;
  let s = 0, m = 0; for (let j = Math.max(0, n - 50); j < n; j++) { s += v[j]; m++; } const avg50 = m ? s / m : 0;
  const hasVol = avg50 > 0 && !noVol; // noVol: prices from a secondary venue, whose volume says little
  let vr = hasVol ? v[n] / avg50 : null; if (vr != null && vr > 25) vr = null; // implausible: usually a data glitch
  let up = 0, dn = 0; for (let j = Math.max(1, n - 49); j <= n; j++) { if (c[j] > c[j - 1]) up += v[j]; else if (c[j] < c[j - 1]) dn += v[j]; }
  const ud = hasVol && dn > 0 ? up / dn : null;
  const smaAt = (k, i) => { if (i < k - 1) return null; let t = 0; for (let j = i - k + 1; j <= i; j++) t += c[j]; return t / k; };
  const s50 = smaAt(50, n), s200 = smaAt(200, n);
  let hi52 = -Infinity, lo52 = Infinity; for (let j = Math.max(0, n - 251); j <= n; j++) { hi52 = Math.max(hi52, b[j].high); lo52 = Math.min(lo52, b[j].low); }
  const q = k => n - 63 * k >= 0 ? c[n - 63 * (k - 1)] / c[n - 63 * k] - 1 : null;
  const rsRaw = [q(1), q(2), q(3), q(4)].every(x => x != null) ? 0.4 * q(1) + 0.2 * q(2) + 0.2 * q(3) + 0.2 * q(4) : (q(1) != null && q(2) != null ? 0.6 * q(1) + 0.4 * q(2) : null);
  let rsh = null;
  if (bench && bench.length) { const k = calc(b, false, bench); if (k.rs[n] != null) rsh = rsNewHigh(k.rs, 252); }
  const curP = R.cur.filter(p => p.pivot);
  const lastBO = R.last && !R.last.failed && n - R.last.bo <= 40 ? R.last : null;
  let p = null;
  if (curP.length) { const x = curP[0], di = c[n] / x.pivot - 1; p = { n: x.name, t: x.type, w: Math.round(x.weeks), dp: x.depth, pv: x.pivot, di, st: di >= -0.05 ? 'near' : 'forming', f: x.faulty }; }
  else if (lastBO) { const g = c[n] / lastBO.pivot - 1; p = { n: lastBO.name, t: lastBO.type, w: Math.round(lastBO.weeks), dp: lastBO.depth, pv: lastBO.pivot, di: g, bo: n - lastBO.bo, vr: lastBO.volRatio, st: g < -0.08 ? 'stop' : g < 0 ? 'below' : g <= 0.05 ? 'buyzone' : 'extended', f: lastBO.faulty }; }
  else { const desc = R.cur.find(x => x.type === 'desc'); if (desc) p = { n: desc.name, t: 'desc', w: Math.round(desc.weeks), dp: desc.depth, st: 'faulty', f: true }; }
  const buy = [], sell = [];
  const chg = c[n] / c[n - 1] - 1, upDay = chg > 0;
  if (p && p.st === 'buyzone' && p.bo <= 5) buy.push(`Breakout ${p.bo === 0 ? 'today' : p.bo + 'd ago'} from ${p.n}${p.vr >= 1.4 ? ' on volume' : ', volume below +40%'}`);
  else if (p && p.st === 'buyzone') buy.push(`In buy zone of ${p.n}`);
  if (p && p.st === 'near') buy.push(`${Math.abs(p.di * 100).toFixed(1)}% from the ${p.n} buy point`);
  if (vr != null && vr >= 2 && upDay) buy.push(`Volume ×${vr.toFixed(1)} on an up day`);
  // pocket pivot: up-day volume above the largest down-day volume of the prior 10 sessions, above the 10- and 50-day lines
  let maxDn = 0; for (let j = n - 10; j < n; j++) if (j > 0 && c[j] < c[j - 1]) maxDn = Math.max(maxDn, v[j]);
  const s10 = smaAt(10, n); if (hasVol && upDay && maxDn > 0 && v[n] > maxDn && s10 && s50 && c[n] > s10 && c[n] > s50) buy.push('Pocket pivot');
  if (s200 && c[n] < s200 && c[n - 1] >= smaAt(200, n - 1)) sell.push('Closed below the 200-day line');
  if (s50 && c[n] < s50 && c[n - 1] >= smaAt(50, n - 1) && vr != null && vr >= 1.4) sell.push('Heavy-volume break of the 50-day line');
  if (p && p.st === 'stop') sell.push('8% below the buy point (stop)');
  if (R.last && R.last.failed && n - R.last.failed <= 10) sell.push('Failed breakout');
  if (s50 && c[n] / s50 - 1 > 0.25) sell.push(`${Math.round((c[n] / s50 - 1) * 100)}% above the 50-day line (climax risk)`);
  if (vr != null && vr >= 2 && !upDay && chg < -0.02) sell.push(`Volume ×${vr.toFixed(1)} on a down day`);
  const sp = []; const from = Math.max(0, n - 59); let lo = Infinity, hi = -Infinity;
  for (let j = from; j <= n; j++) { lo = Math.min(lo, c[j]); hi = Math.max(hi, c[j]); }
  for (let j = from; j <= n; j += 2) sp.push(hi > lo ? Math.round((c[j] - lo) / (hi - lo) * 99) : 50);
  return {
    s: sym, nm: name, c: c[n], d1: ch(1), w1: ch(5), m1: ch(21), m3: ch(63), m6: ch(126), y1: ch(252),
    vr, ud, dv: avg50 * c[n], s50: s50 ? c[n] / s50 - 1 : null, s200: s200 ? c[n] / s200 - 1 : null,
    hi: c[n] / hi52 - 1, lo: c[n] / lo52 - 1, rsRaw, rs: null, rsh, p, buy, sell, sp, dt: b[n].time,
  };
}

/** Rank RS scores 1–99 within the scanned set (the app's own strength rank). */
export function rankRS(rows) {
  const xs = rows.filter(r => r.rsRaw != null).sort((a, b) => a.rsRaw - b.rsRaw);
  xs.forEach((r, i) => { r.rs = xs.length > 1 ? Math.max(1, Math.min(99, Math.round(1 + 98 * i / (xs.length - 1)))) : 50; });
  return rows;
}
