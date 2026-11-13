import test from 'node:test';
import assert from 'node:assert/strict';
import { mentionedHolding, holdingAnswer, learnFromText, takeLearnTags } from '../src/core/coachbrain.js';

const H = [{ sym: 'MSFT' }, { sym: 'MA' }, { sym: 'UCB.BR' }, { sym: 'GCT' }];
const names = { MSFT: 'Microsoft Corporation', MA: 'Mastercard Incorporated', 'UCB.BR': 'UCB SA', GCT: 'GigaCloud Technology' };

test('finds the holding the question names, in any case, not the stock on screen', () => {
  assert.equal(mentionedHolding('but why sell msft if ibd says to hold or buy', H, names), 'MSFT');
  assert.equal(mentionedHolding('what about microsoft?', H, names), 'MSFT');
  assert.equal(mentionedHolding('should I keep ucb', H, names), 'UCB.BR');
  assert.equal(mentionedHolding('why sell MA now', H, names), 'MA');
  assert.equal(mentionedHolding('my ma said hello', H, names), null); // two letters only in capitals
  assert.equal(mentionedHolding('how is the market', H, names), null);
});

const rv = (x, extra = {}) => ({ S: { stop: 0.07, posPct: 0.2 }, z: { market: 'corr' }, max: 1, items: [x, { sym: 'MA', score: 40 }, { sym: 'GCT', score: 90 }], rank: { list: [{ sym: 'MA', score: 40 }, x, { sym: 'GCT', score: 90 }], sellNow: [] }, ...extra });
const msft = { sym: 'MSFT', name: 'Microsoft', verdict: 'hold', score: 66, cost: 400, s50: 420, reasons: [['ok', 'Above its 50- and 200-day lines.'], ['warn', '+2.0% in 8 weeks.']], m: { gain: 0.08, above50: true, above200: true, w8: 0.02, rs: 70 } };

test('explains that a healthy holding was cut for the market, not the chart', () => {
  const a = holdingAnswer('but why sell msft if ibd says to hold or buy', msft, rv(msft));
  assert.match(a, /chart itself is fine/);
  assert.match(a, /correction/);
  assert.match(a, /IBD/);
  assert.match(a, /MSFT/);
  assert.doesNotMatch(a, /NVDA/);
});

test('a broken sell rule still says sell', () => {
  const x = { ...msft, verdict: 'sell', reasons: [['bad', '−9.0% on your average price: past your 7% stop.']], m: { ...msft.m, gain: -0.09 } };
  assert.match(holdingAnswer('why sell msft', x, rv(x)), /sell rule is broken/);
});

test('learns rules the owner states', () => {
  assert.match(learnFromText("i don't have nvidia stop starting with it"), /does not own NVIDIA/);
  assert.match(learnFromText('I do not own NVDA'), /does not own NVDA/);
  assert.match(learnFromText('always show the stop in euro please'), /owner said/);
  assert.equal(learnFromText('why sell msft?'), null);
});

test('takes the learn tags out of a Claude answer', () => {
  const r = takeLearnTags('Hold MSFT.\n\nNot investment advice.\n<<learn: The owner does not own NVDA.>>');
  assert.deepEqual(r.notes, ['The owner does not own NVDA.']);
  assert.doesNotMatch(r.text, /learn/);
});
