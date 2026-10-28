// Pattern phase: a compact tag and a step indicator (left side → right side → handle → near buy point → buy zone →
// extended → profit zone) used on the stock page, the watchlist, the screener and the portfolio.
import { html } from './dom.js';
import { PHASES } from '../core/analysis.js';

const TONE = { ok: 't-ok', warn: 't-warn', bad: 't-bad', blue: 't-blue', mute: 't-mute' };
export const phaseTag = (ph, { stage = true } = {}) => ph ? html`<span class="tag ${TONE[ph.tone] || 't-mute'}" title="${ph.detail || ''}">${ph.label}${stage && ph.stage ? ' · stage ' + ph.stage : ''}</span>` : '';

export function phaseStrip(ph) {
  if (!ph) return '';
  return html`<div class="phase">
    <div class="phase-steps" role="img" aria-label="Pattern phase: ${ph.label}">${PHASES.map((p, i) => html`<div class="ps ${ph.step === i + 1 ? 'on ' + (TONE[ph.tone] || '') : ph.step && i + 1 < ph.step ? 'done' : ''}"><i></i><span>${p}</span></div>`)}</div>
    <p class="small" style="margin:0"><b>${ph.label}</b>${ph.stage ? ` · stage ${ph.stage} base` : ''}${ph.step ? '' : ' (outside the normal cycle)'} — ${ph.detail}</p></div>`;
}
