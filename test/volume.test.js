import test from 'node:test';
import assert from 'node:assert/strict';
import { volStats, weekOf, sessionShare } from '../src/core/volume.js';

const D = 86400;
// 60 weekdays starting Monday 5 Jan 2026, 1,000 shares a day; the last day trades 3,000 on an up close
const MON = Date.UTC(2026, 0, 5) / 1000;
function days(n) { const out = []; let t = MON; while (out.length < n) { const wd = new Date(t * 1000).getUTCDay(); if (wd && wd !== 6) out.push(t); t += D; } return out; }
const mk = () => days(60).map((t, i) => ({ time: t, open: 100 + i * 0.1, high: 101 + i * 0.1, low: 99 + i * 0.1, close: 100 + i * 0.1 + (i % 2 ? 0.2 : -0.2), volume: 1000 }));

test('week numbers start on Monday', () => {
  assert.equal(weekOf(MON), weekOf(MON + 4 * D)); // Mon..Fri same week
  assert.equal(weekOf(MON + 7 * D), weekOf(MON) + 1);
  assert.equal(weekOf(MON - D), weekOf(MON) - 1); // Sunday belongs to the week before
});

test('today vs the 50-day average, the week so far and the 10-week average', () => {
  const b = mk(); b[59].volume = 3000;
  const s = volStats(b);
  assert.equal(s.avg50, 1000); assert.equal(s.vol, 3000); assert.ok(Math.abs(s.pct - 2) < 1e-9);
  assert.equal(s.avgWeek, 5000); // full weeks of 5 × 1,000
  assert.equal(s.week.days, 5); assert.equal(s.week.vol, 7000); // the 12th week: 4 × 1,000 + 3,000
  assert.ok(Math.abs(s.week.vsAvgWeek - 0.4) < 1e-9);
  assert.ok(s.since && s.since.days >= 50); // highest volume in all the data
  assert.ok(Math.abs(s.breakoutNeed - 1400) < 1e-9);
});

test('up/down volume ratio is above 1 when up days carry more volume', () => {
  const b = mk(); for (let i = 1; i < b.length; i++) b[i].volume = b[i].close > b[i - 1].close ? 2000 : 1000;
  assert.ok(volStats(b).udRatio > 1.5);
});

test('while trading, the full-day estimate scales up the partial volume', () => {
  const b = mk(), last = b[59].time; b[59].volume = 500;
  const quote = { off: 0, session: { start: last + 9.5 * 3600, end: last + 16 * 3600 } };
  const mid = quote.session.start + (quote.session.end - quote.session.start) / 2;
  const s = volStats(b, { quote, now: mid });
  assert.equal(s.open, true); assert.ok(Math.abs(s.pace - 500 / sessionShare(0.5)) < 1e-6);
  assert.ok(s.pace > 1000 && s.pace < 1300); // half the session done, somewhat less than half the volume traded
  assert.equal(volStats(b, { quote, now: quote.session.end + 60 }).open, false);
  assert.equal(sessionShare(0), 0); assert.equal(sessionShare(1), 1);
});

test('no volume in the feed: nothing to show', () => {
  assert.equal(volStats(mk().map(x => ({ ...x, volume: 0 }))), null);
});
