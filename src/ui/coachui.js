// The O'Neil Coach chat sheet. Context comes from the app (current stock, market, portfolio, plan settings);
// answers come from the playbook (offline) or from Claude with the user's own API key.
import { coachContext, askOffline, askClaude } from '../data/coach.js';
import { settings } from '../data/service.js';
import { strategy } from '../data/plans.js';
import { App, go } from '../app.js';
import { $, $$, html, raw, render, sheet, esc } from './dom.js';

const C = { msgs: [], busy: false };
let stockCtx = null;
/** The stock page registers a function here that describes the stock on screen. */
export const setCoachStock = fn => { stockCtx = fn; };

const SUGGEST = ['Would O’Neil buy this here?', 'When should I sell?', 'Is there an early entry?', 'How much would I buy, and in what steps?', 'How is the market?', 'Does this company have a moat?'];

export function openCoach() {
  const sh = sheet('O’Neil Coach', html`
    <div class="coach">
      <div class="coach-log" id="coLog"></div>
      <div class="chips" id="coSug">${SUGGEST.map((s, i) => html`<button class="chip" data-sug="${i}">${s}</button>`)}</div>
      <form class="row" id="coForm" style="gap:8px"><input class="input" id="coIn" placeholder="Ask what O'Neil would do…" autocomplete="off" style="flex:1"><button class="btn primary" type="submit" id="coSend">Ask</button></form>
      <p class="muted tiny" style="margin:0" id="coFoot"></p>
    </div>`);
  const log = $('#coLog', sh), foot = $('#coFoot', sh);
  const online = !!(settings.keys.anthropic || '').trim();
  foot.innerHTML = (online ? `Answers by ${esc(settings.coachModel || 'claude-opus-5-5')} with your own API key (sent only to api.anthropic.com), using your playbook and the app's live numbers.` : 'Offline answers from your playbook and the app’s own analysis. Add your Anthropic API key in <a href="#" id="coSet">Settings → Coach</a> for full conversations.') + ' Educational, not investment advice.';
  const set = $('#coSet', sh); if (set) set.onclick = e => { e.preventDefault(); sh.close(); go('settings'); };
  const paint = () => {
    render(log, html`${C.msgs.length ? C.msgs.map(m => html`<div class="co-m ${m.role}">${m.role === 'assistant' ? raw(mdLite(m.content)) : m.content}</div>`) : html`<div class="co-m assistant">Hi Emiel. Ask me what O'Neil (and your own playbook) would do — about ${stockCtx && stockCtx() ? 'the stock on your screen, ' : ''}buying, selling, sizing, early entries, the market or a company's moat.</div>`}${C.busy ? html`<div class="co-m assistant"><span class="spinner"></span> thinking…</div>` : ''}`);
    log.scrollTop = log.scrollHeight;
  };
  const ask = async text => {
    if (!text.trim() || C.busy) return;
    C.msgs.push({ role: 'user', content: text.trim() }); C.busy = true; paint();
    const ctx = coachContext({ stock: stockCtx ? stockCtx() : null, mkt: App.mkt, holdings: App.holdings, strategy: await strategy() });
    let answer;
    try { answer = online ? await askClaude(C.msgs.map(m => ({ role: m.role, content: m.content })), ctx) : askOffline(text, ctx); }
    catch (e) { answer = '⚠️ ' + e.message + (online ? '\n\n' + askOffline(text, ctx) : ''); }
    C.msgs.push({ role: 'assistant', content: answer }); C.busy = false;
    if (C.msgs.length > 24) C.msgs = C.msgs.slice(-24);
    paint();
  };
  $('#coForm', sh).onsubmit = e => { e.preventDefault(); const v = $('#coIn', sh).value; $('#coIn', sh).value = ''; ask(v); };
  $$('[data-sug]', sh).forEach(b => { b.onclick = () => ask(SUGGEST[+b.dataset.sug]); });
  paint();
  setTimeout(() => $('#coIn', sh).focus(), 60);
}

/** Minimal safe markdown: bold, bullets and line breaks (the input is first HTML-escaped). */
function mdLite(t) {
  return esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/^• /gm, '&bull; ').replace(/\n/g, '<br>');
}
