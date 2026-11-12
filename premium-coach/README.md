# Premium Coach

A learning app and trading plan for collecting option premiums in a defensive way. It follows William O'Neil's and IBD's market-direction rules, and you place the trades at DEGIRO.

## Files

- `index.html`: the app. Double-click it on your Mac and it opens in your browser. It works offline.
- `app.html`: the same app without the HTML wrapper, used to publish it as a claude.ai page.

## Put it in your Mac's Dock

1. Open the published page in **Safari** (macOS Sonoma 14 or later).
2. Choose **File → Add to Dock**.
3. It now opens in its own window, like any other Mac app.

## What is inside

- **Today**: pick the market state (IBD's Market Pulse, or use the built-in helper) and the volatility level. The app then tells you whether you may sell puts, how much, at what delta and with how many days to expiry.
- **Learn**: 21 lessons in 5 modules, from the basics up to O'Neil and DEGIRO, each with a quiz.
- **Stocks**: European stocks and indexes with options on Euronext Amsterdam or Eurex, plus an 11-point checklist (CAN SLIM and option safety).
- **Option finder**: search an underlying, see the upcoming expiry dates and estimated call and put premiums for every strike, and turn a real DEGIRO bid/ask into implied volatility and delta. Links to Euronext, Eurex, TradingView and earnings calendars.
- **Trading plan**: the written rules, scaled to your account size.
- **Calculator**: the numbers and a profit/loss chart for a cash-secured put or a covered call, checked against the plan.
- **DEGIRO guide**: step by step, with the items you still need to confirm in your own account.
- **Journal**: a trade log with backup and restore.
- **Websites**: where to look up option prices, expiry dates, market direction, volatility and earnings dates.

Your data (journal, checklists, settings) is saved only in the browser you use.

## Live market data

`fetch_data.py` collects:

- share and index prices, 50- and 200-day lines, 52-week highs and S&P 500 / Nasdaq distribution days from Yahoo Finance;
- real option prices (bid, ask, last for every strike and expiry) for Euronext Amsterdam and Brussels stocks from Beursgenoten.nl.

It stores them in `data.json`, puts them into `app.html` and rebuilds `index.html`. The data is a snapshot: it is as fresh as the last run.

To refresh on your Mac (Python 3 is needed; macOS offers to install it the first time):

```bash
python3 premium-coach/fetch_data.py
```

Then open `index.html` again.

AEX, Euro Stoxx 50 and German (Eurex) stocks show live share prices with *estimated* premiums, because there is no free source of their option prices that the script can read.

This is a learning tool, not financial advice.
