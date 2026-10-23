// Exposure checklist: the factors for raising or cutting market exposure, measured where the data allows
// (index action, distribution days, how breakouts and leaders behave in the last scan) and left to the user's
// judgement where it doesn't (reaction to news and earnings).

const pct = x => (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%';

/** Index helpers on an analyseIndex() result R. */
function idx(R, look = 10) {
  const { c, v, b, n } = R, from = Math.max(1, n - look + 1);
  let acc = 0, dist = 0, strong = 0, bigDown = 0, stall = 0, worst = 0;
  for (let i = from; i <= n; i++) {
    const ch = c[i] / c[i - 1] - 1, volUp = v[i] > v[i - 1] && v[i - 1] > 0;
    if (ch >= 0.002 && volUp) acc++;
    if (ch <= -0.002 && volUp) dist++;
    if (ch >= 0.01 && volUp) strong++;
    if (ch <= -0.02) bigDown++;
    worst = Math.min(worst, ch);
    const mid = (b[i].high + b[i].low) / 2;
    if (ch > 0 && ch < 0.004 && volUp && c[i] < mid) stall++; // stalling: small gain on higher volume, close in the lower half
  }
  return { acc, dist, strong, bigDown, stall, worst };
}

/**
 * rs: [{name, R}] for the leading indexes (Nasdaq, S&P 500). rows: last scan rows (optional).
 * manual: {key: true/false} for the judgement items. Returns {up: [...], down: [...], score, advice, raiseCash}.
 * Each item: {key, label, ok (true = factor present, false = absent, null = unknown), detail, manual?}.
 */
export function exposureFactors(rs, rows = [], manual = {}) {
  const R = rs.filter(x => x && x.R && x.R.n > 60);
  if (!R.length) return null;
  const I = R.map(x => ({ name: x.name, R: x.R, ...idx(x.R, 10), s15: idx(x.R, 15) }));
  const any = f => I.some(f), all = f => I.every(f);
  const desc = f => I.map(f).join(' · ');
  const vol = all(x => x.R.hasVol);
  const up = [], down = [];
  // ---- factors for increasing exposure
  up.push({ key: 'risevol', label: 'Indexes rising and volume rising', ok: vol ? any(x => x.acc > x.dist && x.acc >= 3) : null,
    detail: vol ? desc(x => `${x.name}: ${x.acc} up days on higher volume vs ${x.dist} distribution days (10 sessions)`) : 'No index volume data.' });
  up.push({ key: 'highs', label: 'Indexes at or near new highs', ok: any(x => x.R.off >= -0.03), detail: desc(x => `${x.name} ${pct(x.R.off)} from its 52-week high`) });
  up.push({ key: 'support', label: 'Indexes above key support (21-day and 50-day lines)', ok: all(x => x.R.c[x.R.n] > x.R.e21[x.R.n] && x.R.c[x.R.n] > x.R.s50[x.R.n]),
    detail: desc(x => `${x.name} ${pct(x.R.c[x.R.n] / x.R.s50[x.R.n] - 1)} vs its 50-day`) });
  up.push({ key: 'trend', label: 'Indexes trending above their moving averages', ok: all(x => { const n = x.R.n; return x.R.c[n] > x.R.s50[n] && x.R.s50[n] > x.R.s200[n] && x.R.s50[n] > x.R.s50[n - 10]; }),
    detail: desc(x => { const n = x.R.n; return `${x.name}: 50-day ${x.R.s50[n] > x.R.s50[n - 10] ? 'rising' : 'falling'}, ${x.R.s50[n] > x.R.s200[n] ? 'above' : 'below'} the 200-day`; }) });
  const bo = rows.filter(r => r.p && r.p.bo != null && r.p.bo <= 15 && !r.p.f);
  const working = bo.filter(r => r.p.st === 'buyzone' || r.p.st === 'extended');
  up.push({ key: 'breakouts', label: 'Stocks breaking out and working', ok: bo.length >= 4 ? working.length / bo.length >= 0.6 : rows.length ? false : null,
    detail: rows.length ? `${bo.length} breakouts in the last 15 sessions of the scan, ${working.length} still at or above the buy point` : 'Run a scan on the Screener tab to measure this.' });
  up.push({ key: 'strong', label: 'Strong market days occurring frequently', ok: vol ? any(x => x.s15.strong >= 2) : null, detail: vol ? desc(x => `${x.name}: ${x.s15.strong} days of +1% or more on higher volume (15 sessions)`) : 'No index volume data.' });
  const ftd = I.find(x => x.R.lastFtd != null && x.R.n - x.R.lastFtd <= 25 && x.R.state !== 'corr');
  up.push({ key: 'ftd', label: 'Follow-through day confirmed a new rally', ok: !!ftd, detail: ftd ? `${ftd.name}: follow-through ${ftd.R.n - ftd.R.lastFtd} sessions ago. Early in a new uptrend: start with small positions and add as breakouts work.` : 'No recent follow-through day.' });
  up.push({ key: 'news', label: 'Positive reaction to news', ok: manual.news ?? null, manual: true, detail: 'Your judgement: do stocks and indexes rise on good news?' });
  up.push({ key: 'resilient', label: 'Resilience to bad news', ok: manual.resilient ?? null, manual: true, detail: 'Your judgement: does the market shrug off bad news?' });
  // ---- factors for reducing exposure
  const lead = rows.filter(r => r.rs >= 80);
  const breaking = lead.filter(r => r.sell.some(s => /50-day|200-day|Failed breakout|stop/.test(s)));
  down.push({ key: 'leaders', label: 'Leading stocks breaking down or topping', ok: lead.length >= 5 ? breaking.length / lead.length >= 0.25 : rows.length ? false : null,
    detail: rows.length ? `${breaking.length} of ${lead.length} leaders (strength 80+) show sell signals` : 'Run a scan to measure this.' });
  const ext = lead.filter(r => r.s50 != null && r.s50 > 0.2);
  down.push({ key: 'extended', label: 'Stocks extended from their moving averages', ok: lead.length >= 5 ? ext.length / lead.length >= 0.3 : rows.length ? false : null,
    detail: rows.length ? `${ext.length} of ${lead.length} leaders are more than 20% above their 50-day line` : 'Run a scan to measure this.' });
  down.push({ key: 'goodnews', label: 'Stocks stop responding well to good news', ok: manual.goodnews ?? null, manual: true, detail: 'Your judgement.' });
  down.push({ key: 'earnings', label: 'Stocks not responding well to earnings reports', ok: manual.earnings ?? null, manual: true, detail: 'Your judgement: are good reports sold?' });
  down.push({ key: 'bigdown', label: 'Outsized down days in the market', ok: any(x => x.bigDown > 0), detail: desc(x => `${x.name}: worst day ${pct(x.worst)} in 10 sessions`) });
  down.push({ key: 'dd', label: 'Distribution days piling up', ok: vol ? any(x => x.R.dd.length >= 5 || x.R.dd.filter(i => x.R.n - i < 10).length >= 3) : null,
    detail: vol ? desc(x => `${x.name}: ${x.R.dd.length} in the count, ${x.R.dd.filter(i => x.R.n - i < 10).length} in the last 10 sessions`) : 'No index volume data.' });
  down.push({ key: 'stall', label: 'Stalling action', ok: vol ? any(x => x.stall >= 2) : null, detail: vol ? desc(x => `${x.name}: ${x.stall} stalling days (small gain on higher volume, weak close)`) : 'No index volume data.' });
  const weak = I.find(x => x.R.state === 'corr' && x.R.rallyDay >= 4);
  down.push({ key: 'weakrally', label: 'Weak rally attempt', ok: I.some(x => x.R.state === 'corr') ? !!weak : false, detail: weak ? `${weak.name}: day ${weak.R.rallyDay} of a rally attempt without a follow-through day` : 'No failing rally attempt.' });
  const yes = l => l.filter(x => x.ok === true).length, known = l => l.filter(x => x.ok != null).length;
  const score = yes(up) - yes(down);
  const ddHeavy = down.find(x => x.key === 'dd').ok, leadersBreak = down.find(x => x.key === 'leaders').ok;
  const raiseCash = yes(down) >= 4 || (ddHeavy && (leadersBreak || down.find(x => x.key === 'bigdown').ok));
  const advice = raiseCash ? 'Sell laggards first, tighten stops on the rest, no new buys.' : score >= 3 ? 'Conditions favour increasing exposure: buy proper breakouts, add to positions that work.' : score <= -2 ? 'Conditions favour reducing exposure: be very selective and take some profits.' : 'Mixed signals: hold exposure steady and be selective.';
  return { up, down, upYes: yes(up), downYes: yes(down), upKnown: known(up), downKnown: known(down), score, advice, raiseCash };
}
