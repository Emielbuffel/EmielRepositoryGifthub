// The O'Neil Coach chat sheet. Context comes from the app (current stock, market, portfolio, plan settings);
// answers come from the playbook (offline) or from Claude with the user's own API key.
import { coachContext, askOffline, aiMode, askCoachAI, addLearned } from '../data/coach.js';
import { settings } from '../data/service.js';
import { strategy } from '../data/plans.js';
import { App, go } from '../app.js';
import { $, $$, html, raw, render, sheet, esc, toast } from './dom.js';
import { looksLikeTrades } from '../core/tradetalk.js';
import { tailoredAnswer, portfolioAnswer, PORTFOLIO_Q, mentionedHolding, holdingAnswer, learnFromText, takeLearnTags } from '../core/coachbrain.js';
import { reviewHoldings } from '../data/holdreview.js';
import { draftTrades, saveTrades, normaliseWithClaude } from '../data/tradechat.js';

const C = { msgs: [], busy: false };
let stockCtx = null, chartPic = null;
/** The stock page registers a function here that describes the stock on screen. */
export const setCoachStock = fn => { stockCtx = fn; };
/** …and one that returns a picture (PNG Blob) of the chart on screen, so the coach can look at it. */
export const setCoachChart = fn => { chartPic = fn; };

const SUGGEST0 = ['Would O’Neil buy this here?', 'When should I sell?', 'Is there an early entry?', 'How much would I buy, and in what steps?', 'How is the market?', 'Does this company have a moat?'];

// examples with your own stocks, never a stock you don't own
const suggestions = () => {
  const h = (App.holdings || []).filter(x => x.sym && x.shares > 0), a = h[0] && h[0].sym, b = h[1] && h[1].sym;
  return [...(h.length ? ['Look at my portfolio: what should I trim?', `Why would you sell ${a}?`] : []), ...(b ? [`Should I add to ${b}?`] : []), ...SUGGEST0].slice(0, 7);
};
const MARK = 'Educational analysis, not investment advice.';

export function openCoach() {
  const SUGGEST = suggestions();
  const sh = sheet('O’Neil Coach', html`
    <div class="coach">
      <div class="coach-log" id="coLog"></div>
      <div class="chips" id="coSug">${SUGGEST.map((s, i) => html`<button class="chip" data-sug="${i}">${s}</button>`)}</div>
      <div class="row co-att" id="coAtt" style="gap:8px;flex-wrap:wrap"></div>
      <form class="row" id="coForm" style="gap:8px"><label class="btn sm" title="Add a picture (a screenshot of a chart, DEGIRO, …)" style="cursor:pointer">📎<input type="file" id="coFile" accept="image/*" multiple hidden></label><input class="input" id="coIn" placeholder="Ask anything, or tell me a trade: bought 20 ASML at 640" autocomplete="off" style="flex:1"><button class="btn primary" type="submit" id="coSend">Ask</button></form>
      <label class="small row" style="gap:6px;margin:0" id="coPicRow" hidden><input type="checkbox" id="coPic" checked> Show the coach the chart on my screen with each question</label>
      <p class="muted tiny" style="margin:0" id="coFoot"></p>
    </div>`);
  const log = $('#coLog', sh), foot = $('#coFoot', sh);
  let online = false, mode = null; const att = [];
  const setFoot = () => {
    foot.innerHTML = (mode === 'page' ? 'Answers by Claude through your claude.ai account (no API key needed): it sees the chart on your screen, your playbook and the app\'s numbers.'
      : mode === 'key' ? `Answers by ${esc(settings.coachModel || 'claude-opus-5-5')} with your own API key (sent only to api.anthropic.com): it sees the chart on your screen, your playbook and the app's numbers.`
      : 'Offline answers from your playbook and the app’s own numbers. For a real conversation that also looks at the chart: open the app\'s page on claude.ai, or add your Anthropic API key in <a href="#" id="coSet">Settings → Coach</a>.') + ' Educational, not investment advice.';
    const set = $('#coSet', sh); if (set) set.onclick = e => { e.preventDefault(); sh.close(); go('settings'); };
    $('#coPicRow', sh).hidden = !online || !chartPic;
  };
  aiMode().then(m => { mode = m; online = !!m; setFoot(); });
  setFoot();
  const showAtt = () => { render($('#coAtt', sh), html`${att.map((b, i) => html`<span class="chip on">🖼 picture ${i + 1} <button class="btn sm" data-rm="${i}" style="padding:0 4px">✕</button></span>`)}`); $$('[data-rm]', sh).forEach(x => { x.onclick = () => { att.splice(+x.dataset.rm, 1); showAtt(); }; }); };
  $('#coFile', sh).onchange = e => { for (const f of e.target.files) if (/^image\//.test(f.type) && att.length < 3) att.push(f); e.target.value = ''; showAtt(); if (!online) toast('Pictures are read only by Claude (claude.ai page or your API key).'); };
  const paint = () => {
    render(log, html`${C.msgs.length ? C.msgs.map((m, i) => m.trades ? tradeCard(m, i) : html`<div class="co-m ${m.role}">${m.role === 'assistant' ? raw(mdLite(m.content || '…')) : m.content}${m.pics ? html`<div class="tiny" style="opacity:.8">🖼 ${m.pics}</div>` : ''}${m.role === 'assistant' && m.q && !(C.streaming && i === C.msgs.length - 1) ? html`<div class="row tiny" style="gap:6px;margin-top:6px;opacity:.85">${m.fb ? html`<span>${m.fb}</span>` : html`<button class="btn sm" data-good="${i}" title="Good answer: the coach keeps it as an example (private)">👍</button><button class="btn sm" data-bad="${i}" title="Not good: tell the coach what was wrong, it remembers (private)">👎</button>`}</div>` : ''}</div>`) : html`<div class="co-m assistant">Hi. Ask me what O'Neil (and your own playbook) would do — about ${stockCtx && stockCtx() ? 'the stock on your screen, ' : ''}buying, selling, sizing, early entries, the market or a company's moat. Or tell me a trade you did (“bought 50 NVDA at 182.30”, “verkocht de helft van mijn ASML aan 640”) and I add it to your holdings once you have checked it.</div>`}${C.busy && !C.streaming ? html`<div class="co-m assistant"><span class="spinner"></span> ${online ? 'looking at the chart and thinking…' : 'thinking…'}</div>` : ''}`);
    log.scrollTop = log.scrollHeight;
    wireTrades();
    $$('[data-good]', log).forEach(b => { b.onclick = async () => { const m = C.msgs[+b.dataset.good]; await addLearned('example', m.content.replace(MARK, '').trim(), m.q); m.fb = '👍 Kept as a good example (private).'; paint(); }; });
    $$('[data-bad]', log).forEach(b => { b.onclick = () => { const m = C.msgs[+b.dataset.bad]; m.fb = '👎 noted'; C.fix = m; C.msgs.push({ role: 'assistant', content: 'What was wrong, or what should I have said? Type it below — I save it as a rule and use it from now on (it stays private).' }); paint(); $('#coIn', sh).focus(); }; });
  };
  // trade cards: edit the fields, then save or cancel
  const wireTrades = () => {
    $$('[data-tcard]', log).forEach(card => {
      const m = C.msgs[+card.dataset.tcard]; if (!m || m.state !== 'open') return;
      $$('[data-f]', card).forEach(inp => { inp.onchange = () => { const [i, f] = inp.dataset.f.split(':'), d = m.trades[+i]; d[f] = f === 'sym' ? inp.value.toUpperCase().trim() : f === 'side' ? inp.value : f === 't' ? Date.parse(inp.value + 'T12:00:00Z') / 1000 : +String(inp.value).replace(',', '.'); d.problem = ''; }; });
      $$('[data-del]', card).forEach(b => { b.onclick = () => { m.trades.splice(+b.dataset.del, 1); if (!m.trades.length) m.state = 'cancelled'; paint(); }; });
      const ok = $('[data-save]', card), no = $('[data-cancel]', card);
      if (no) no.onclick = () => { m.state = 'cancelled'; C.msgs.push({ role: 'assistant', content: 'OK, nothing was saved.' }); paint(); };
      if (ok) ok.onclick = async () => {
        const bad = m.trades.find(d => !d.sym || !(d.qty > 0) || !(d.price > 0));
        if (bad) { toast('Fill in the ticker, the number of shares and the price for every trade.'); return; }
        ok.disabled = true;
        try { const lines = await saveTrades(m.trades); m.state = 'saved'; C.msgs.push({ role: 'assistant', content: '✅ Saved to your holdings and trade journal:\n' + lines.map(l => '• ' + l).join('\n') + '\n\nYou find them under Portfolio. They also count in Trade review and the capital-gains report as long as no DEGIRO statement is uploaded (the statement then takes over).' }); }
        catch (e) { ok.disabled = false; toast('Not saved: ' + e.message); return; }
        paint();
      };
    });
  };
  const ask = async text => {
    if (!text.trim() || C.busy) return;
    C.msgs.push({ role: 'user', content: text.trim() }); C.busy = true; paint();
    // the answer to a 👎: save it as a rule
    if (C.fix) {
      const m = C.fix; C.fix = null;
      await addLearned('rule', `When asked "${(m.q || '').slice(0, 160)}", the owner said the answer was not good: ${text.trim()}`, m.q);
      C.msgs.push({ role: 'assistant', content: '📝 Thanks — saved as a rule. I use it from now on, on all your devices (private sync).' + (online ? ' Ask the question again and I take it into account.' : ' Offline answers follow fixed rules; the full effect comes with Claude (claude.ai page or your API key).') });
      C.busy = false; paint(); return;
    }
    const rule = learnFromText(text); let noted = '';
    if (rule && await addLearned('rule', rule, text)) noted = '📝 Noted — I remember this from now on.';
    const isQuestion = /\?|\b(why|what|how|when|which|should|would|could|can|is|are|do|does|waarom|wat|hoe|wanneer|welke|moet|zou|kan)\b/i.test(text);
    if (rule && !isQuestion && !online) {
      C.msgs.push({ role: 'assistant', content: (noted || '📝 I already knew that.') + ' ' + (/does not own/.test(rule) ? 'I won\'t talk about it unless you ask — and when the chart on screen is a stock you don\'t own, I\'ll ask which of your stocks you mean.' : 'I follow it from now on (it stays private).') });
      C.busy = false; paint(); return;
    }
    if (looksLikeTrades(text)) {
      let drafts = [];
      try { drafts = await draftTrades(text); } catch (e) { /* fall through to a normal answer */ }
      const issues = list => list.length ? list.filter(d => d.problem).length : 99;
      if ((settings.keys.anthropic || '').trim() && issues(drafts) > 0) { try { const t2 = await normaliseWithClaude(text); if (t2) { const d2 = await draftTrades(t2); if (issues(d2) < issues(drafts)) drafts = d2; } } catch (e) { /* keep the local reading */ } }
      if (drafts.length) { C.msgs.push({ role: 'assistant', trades: drafts, state: 'open' }); C.busy = false; paint(); return; }
    }
    const ctx = coachContext({ stock: stockCtx ? stockCtx() : null, mkt: App.mkt, holdings: App.holdings, strategy: await strategy() });
    let answer, mine = null;
    // which stock the question is about: a holding you name beats the stock on screen
    const onScreen = ctx.stock && ctx.stock.num ? ctx.stock.num.sym : ctx.stock ? ctx.stock.sym : null;
    const named = mentionedHolding(text, App.holdings || [], App.names || {});
    // a ticker you typed in capitals (or with $) that is not one of your holdings
    const typed = !named ? ((/\$([A-Za-z][A-Za-z0-9.]{0,9})\b/.exec(text) || [])[1] || (String(text).match(/\b[A-Z][A-Z0-9]{1,5}(\.[A-Z]{1,3})?\b/g) || []).find(w => !/^(I|IBD|RS|EPS|RSI|ETF|CEO|USA|US|EU|OK|AI|ATH|DEGIRO|CGT|TOB|FTD|SMR|AD|PE|ROE|ROIC|FCF|ADD|SELL|BUY|HOLD|NOT|AND|THE|WHY)$/.test(w))) : null;
    const typedSym = typed ? typed.toUpperCase() : null;
    const other = !!named && named !== onScreen;
    if (named && (App.holdings || []).length) {
      try {
        const rv = await reviewHoldings(), x = rv.items.find(y => y.sym === named);
        if (x) {
          ctx.focus = { sym: x.sym, name: x.name, verdict: x.verdict, keepScore: x.score, reasons: x.reasons.map(r => r[1]), gain: x.m.gain, above50: x.m.above50, above200: x.m.above200, chg8w: x.m.w8, rs: x.m.rs, s50: x.s50, weight: x.weight, market: rv.z ? rv.z.market : null, maxPositions: rv.max, positions: rv.items.length };
          if (other) ctx.stockOnScreen = 'The chart on screen shows ' + onScreen + ', but this question is about ' + named + ' — answer about ' + named + '.';
          if (!PORTFOLIO_Q.test(text) || /\b(why|waarom)\b/i.test(text)) mine = holdingAnswer(text, x, rv);
        }
      } catch (e) { /* fall back */ }
    }
    // a question about the whole portfolio: go through every position (same analysis as the Sell ideas tab)
    if (!mine && PORTFOLIO_Q.test(text) && (App.holdings || []).length) {
      try {
        const rv = await reviewHoldings();
        ctx.portfolio = { ...(ctx.portfolio || {}), review: rv.items.map(x => ({ sym: x.sym, name: x.name, verdict: x.verdict, keepScore: x.score, gain: x.m.gain != null ? Math.round(x.m.gain * 1000) / 10 + '%' : null, weight: x.weight != null ? Math.round(x.weight * 1000) / 10 + '%' : null, above50: x.m.above50, above200: x.m.above200, chg8w: x.m.w8 != null ? Math.round(x.m.w8 * 1000) / 10 + '%' : null, rs: x.m.rs, ext50: x.ext50 != null ? Math.round(x.ext50 * 1000) / 10 + '%' : null, phase: x.phase, wrongTickerSuspect: x.odd, reasons: x.reasons.map(r => r[1]).slice(0, 4) })), maxPositions: rv.max, sellRuleBroken: rv.rank.sellNow };
        mine = portfolioAnswer(rv);
      } catch (e) { /* fall back */ }
    }
    if (!mine && typedSym && typedSym !== onScreen) {
      ctx.stockOnScreen = 'The chart on screen shows ' + onScreen + ', but this question is about ' + typedSym + ' (not in the holdings).';
      mine = `You asked about ${typedSym}, but the chart on your screen is ${onScreen || 'another stock'} and ${typedSym} isn't in your holdings. Open ${typedSym} on the Chart tab and ask again — then I use its own chart and numbers. If you own it, add it in Portfolio (or tell me "I bought … ${typedSym} at …").` +
        (/\b(ibd|rating|marketsurge)\b/i.test(text) ? `\n\n**About IBD's "hold/buy":** IBD's ratings judge the *company* (earnings, sales, strength). O'Neil's sell rules judge *your position and the market* — the 7–8% stop, a failed breakout, a heavy-volume break of the 50-day line, and how much to own in a correction. A good company can still be trimmed when the market says "less in stocks".` : '');
    }
    if (!mine && ctx.stock && ctx.stock.num) {
      const n = ctx.stock.num, held = (App.holdings || []).filter(h => h.sym && h.shares > 0);
      // a sell/hold question while a stock you don't own is on screen: ask which one you mean instead of guessing
      if (!n.held && /\b(sell|selling|trim|hold|keep|exit|verkop|verkoop|houden)\b/i.test(text) && (/\b(sell|selling|verkop|verkoop|trim)\b/i.test(text) || !/\b(buy|kopen|add)\b/i.test(text)))
        mine = `You don't own ${n.sym} (that's the chart on your screen), so I can't give a sell plan for it. Which stock do you mean? ${held.length ? `You hold ${held.map(h => h.sym).join(', ')}. Ask e.g. "should I sell ${held[0].sym}?" — or "look at my portfolio" for all of them.` : 'Type its ticker in capitals (e.g. MSFT), or add your holdings in Portfolio so I can follow them.'}`;
      else mine = tailoredAnswer(text, n);
    }
    if (online) {
      // a real conversation: the whole chat so far, the chart on screen and any pictures you added
      const pics = att.splice(0); showAtt();
      if ($('#coPic', sh).checked && chartPic && !other && !(typedSym && typedSym !== onScreen)) { try { const b = await chartPic(); if (b) pics.unshift(b); } catch (e) { /* no picture */ } }
      const me = C.msgs[C.msgs.length - 1]; if (pics.length) me.pics = pics.length === 1 && $('#coPic', sh).checked && chartPic ? 'chart sent' : pics.length + ' pictures sent';
      const live = { role: 'assistant', content: '' }; C.msgs.push(live); C.streaming = true;
      const hist = C.msgs.filter(m => !m.trades && m !== live && m.content).map(m => ({ role: m.role, content: m.content }));
      try { answer = await askCoachAI(hist, ctx, pics, t => { live.content = takeLearnTags(t).text; paint(); }); }
      catch (e) { answer = '⚠️ ' + e.message + '\n\n' + (mine ? mine : askOffline(text, ctx)); }
      const lt = takeLearnTags(answer); answer = lt.text;
      let saved = 0; for (const n of lt.notes) if (await addLearned('rule', n, text)) saved++;
      live.content = answer + (saved ? '\n\n📝 I noted this for next time.' : noted ? '\n\n' + noted : ''); live.q = text.trim(); C.streaming = false; C.busy = false;
    } else {
      answer = mine ? mine + '\n\n' + MARK : askOffline(text, ctx);
      if (noted) answer = noted + '\n\n' + answer;
      C.msgs.push({ role: 'assistant', content: answer, q: text.trim() }); C.busy = false;
    }
    if (C.msgs.length > 24) C.msgs = C.msgs.slice(-24);
    paint();
  };
  $('#coForm', sh).onsubmit = e => { e.preventDefault(); const v = $('#coIn', sh).value; $('#coIn', sh).value = ''; ask(v); };
  $$('[data-sug]', sh).forEach(b => { b.onclick = () => ask(SUGGEST[+b.dataset.sug]); });
  paint();
  setTimeout(() => $('#coIn', sh).focus(), 60);
}

const fDay = t => new Date(t * 1000).toISOString().slice(0, 10);
/** The check-before-saving card for trades told in the chat. */
function tradeCard(m, i) {
  const open = m.state === 'open', dis = open ? '' : raw('disabled');
  return html`<div class="co-m assistant co-trades" data-tcard="${i}">
    <b>${m.trades.length === 1 ? 'I read this trade' : `I read ${m.trades.length} trades`}${open ? ' — check it and save:' : m.state === 'saved' ? ' (saved)' : ' (not saved)'}</b>
    ${m.trades.map((d, j) => html`<div class="co-tr">
      <div class="co-tr-row">
        <select class="input sm" data-f="${j}:side" ${dis}><option value="buy" ${d.side === 'buy' ? raw('selected') : ''}>Buy</option><option value="sell" ${d.side === 'sell' ? raw('selected') : ''}>Sell</option></select>
        <input class="input sm" data-f="${j}:qty" inputmode="decimal" value="${d.qty ?? ''}" placeholder="shares" title="Shares" ${dis}>
        <input class="input sm co-sym" data-f="${j}:sym" value="${d.sym}" placeholder="ticker" title="Ticker" autocapitalize="characters" ${dis}>
        <span class="muted">at</span>
        <input class="input sm" data-f="${j}:price" inputmode="decimal" value="${d.price != null ? +(+d.price).toFixed(4) : ''}" placeholder="price" title="Price per share" ${dis}>
        <span class="muted">${d.cur}</span>
        <input class="input sm" type="date" data-f="${j}:t" value="${fDay(d.t)}" title="Date" ${dis}>
        ${open ? html`<button class="btn sm" data-del="${j}" title="Leave this one out">✕</button>` : ''}
      </div>
      <div class="tiny muted">${d.name || ''}${d.held ? ` · you hold ${d.held}` : ''}${d.fee ? ` · costs ${d.fee}` : ''}${d.note ? ' · ' + d.note : ''}</div>
      ${d.problem ? html`<div class="tiny" style="color:var(--warn)">${d.problem}</div>` : ''}
    </div>`)}
    ${open ? html`<div class="row" style="gap:8px;margin-top:6px"><button class="btn primary sm" data-save>Add to my holdings</button><button class="btn sm" data-cancel>Cancel</button></div>` : ''}
  </div>`;
}

/** Minimal safe markdown: bold, bullets and line breaks (the input is first HTML-escaped). */
function mdLite(t) {
  return esc(t).replace(/^#{1,4} (.+)$/gm, '<b>$1</b>').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|\s)\*([^*\n]+)\*(?=\s|$)/g, '$1<i>$2</i>').replace(/^[•\-*] /gm, '&bull; ').replace(/\n/g, '<br>');
}
