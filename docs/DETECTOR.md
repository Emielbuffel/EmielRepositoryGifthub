# The base detector

`src/core/pat.js` is the O'Neil base detector from the original Base Pattern Desk (`scripts/pat.js` / the page's `PAT` block). Its rules are unchanged except for one bug fix, described below.

`PAT.scan(bars)` takes ascending daily bars `{time, open, high, low, close, volume}` and returns:

- `cur`: bases forming now (sound first, then cup with handle, double bottom, cup, ascending, flat, three weeks tight); a descending base only when nothing else is found;
- `hist`: every breakout found, with stage, breakout volume, the best gain within 13 weeks, the 8% stop and failed breakouts;
- `last`: the most recent breakout.

## Rules (summary)

| Base | Coded as |
|---|---|
| Flat base | ≥30 days (book: 6–7+ weeks; 30–34 days flagged as the minimum), depth ≤15%, prior advance ≥20% (under 30% flagged). Buy point = base high + 0.10 |
| Cup with handle | 20+ days (under 30 → faulty, 30–34 → warning), 12–50% deep (over 33% flagged), prior advance ≥25% (under 30% flagged), right side ≥88% of the left high, handle 2–30 days (<5 → faulty), ≤15% deep, in the upper part of the base (lower half → faulty), handle low below the 200-day line → faulty. Buy point = handle high + 0.10 |
| Cup without handle | Right side ≥90% of the left high. Buy point = left-side high + 0.10 |
| Double bottom | Second low undercuts the first by ≤8%; middle peak ≥40% up the base. Buy point = middle peak + 0.10 |
| Ascending base | Three 8–25% pullbacks with rising highs and lows over 40–80 days (from later editions of the book) |
| High tight flag | ≥100% gain in 3–9 weeks, then a 10–30-day flag ≤20% deep (book: +100–120% in 4–8 weeks, 3–5 weeks, 10–20%) |
| Three weeks tight | Three weekly closes within 1.5%, within 15% of the 52-week high, above the 50-day line (from later editions) |
| Descending base | Lower highs and lower lows below the 50-day line; no buy point |

A breakout is a close above the buy point. A breakout fails when the stock closes 2%+ under the buy point within 25 days (before gaining 15%); the base then keeps forming. Faulty bases are shown with "(faulty)" and don't count toward the base stage.

## Checked against the book (October 2026)

The rules were compared with *How to Make Money in Stocks*, 2nd edition (1995), chapters 1–11, 15 and 18. Changes: flat bases need 6 weeks (was 5); a handle below the 200-day line is faulty; high tight flags need a 100% pole and a flag no deeper than 20%; breakouts need volume 50% above average (was 40%); the follow-through day is a 1% gain on day 4–10 of a rally attempt (was 1.2% on day 4+); the growth checklist asks for +20% quarterly EPS and five years of rising annual EPS. Ascending bases and three weeks tight are kept but labelled as later-edition patterns.

## Change from the artifact: missed breakouts fixed

**Bug:** the left-side high was "the highest *close* in the base". When the right side crept up and a close landed above that close, but still under the left-side *intraday high + 10¢* (the buy point), the detector restarted the base on that day. The breakout a few days later was then never recorded, and the pattern disappeared from the chart and the base history.

**Fix:** a close that is above the left-side close but not above its buy point no longer restarts the base:

```js
let a = argmax(b, lo, e, 'close');
while (a > lo) { const a0 = argmax(b, lo, a - 1, 'close'); if (maxClose(b, a0 + 1, e) <= b[a0].high + TICK) a = a0; else break; }
```

**Effect:** on the demo "leader" stock, the base history went from 1 breakout to 3. On the NVDA history stored in the original artifact (used only as a local check, not shipped), the result is otherwise identical. One Sep 2025 breakout is now credited to the 8-week flat base it came out of instead of a "three weeks tight". `test/core.test.js` has a regression test that fails on the old code and passes on the new.

If you keep the claude.ai skill in use, copy this change into the skill's `scripts/pat.js`, the page's `PAT` block and `settings/scripts.pat`, so all three stay identical.

## Demo data

`src/data/demo.js` builds 12 fictional stocks from price "segments" (run-up, cup, handle, breakout…) plus a little noise. `test/core.test.js` checks that the detector finds each intended pattern, so every base type can always be seen in the app.
