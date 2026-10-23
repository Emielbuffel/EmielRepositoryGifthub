# Base Pattern Desk

Base-pattern stock charting for **iPhone, iPad and Mac**. The app finds classic chart bases (cups, flat bases, double bottoms and more) automatically and draws each one in its own colour, with the buy point, the volume checks and the sell rules. It also shows the market direction (distribution and follow-through days), runs a screener on the device, and reviews the risk of your portfolio.

This is a standalone rebuild of the "Base Pattern Desk" claude.ai artifact. That version only worked inside claude.ai: it relied on the page database, the FMP connector and Claude's scheduled tasks. This version runs entirely on the device and can be published on the App Store.

> Educational tool. Not investment advice.

## What's in the app

| Tab | What it does |
|---|---|
| **Chart** | **EPS line** (4-quarter or quarterly, smooth, a dot per report coloured by y/y growth). **Compare** with the home index (S&P 500, Nasdaq, Nikkei 225, DAX, Euro Stoxx 50, FTSE 100, KOSPI…), MSCI World or a US sector ETF, rebased to the left edge; the RS line can use any of these indexes. Earnings table with surprises and the next report date, growth checklist, accumulation grade, liquidity, and **news** from free sources, refreshed every time you open a stock. Daily/weekly candles, 10/21/50/200-day lines, RS line, volume, RSI and MACD. Every detected base is drawn in its own colour, both the current base and every past one (with its outcome). A strip under the chart lists them all; tap one to jump to it. Also: base card with buy point and plan, signal + 11-point checklist, growth checklist, setup score (0–100), flags, key numbers, base history, and your own drawings (trend line, level, zone, your own cup, note). |
| **Market** | Nasdaq, S&P 500, Dow and Euro Stoxx 50 with distribution days (D), follow-through days (FTD), a day-by-day status ribbon, base patterns on the indexes, a list of every distribution day in the count, market headlines, a rule-of-thumb exposure guide and a **sector ranking** from the latest scan. "Analyse & draw" opens an index in the full chart, where you can draw and see all its patterns. |
| **Screener** | Scans all 382 built-in stocks, a watchlist, your portfolio or your own list: breakouts, stocks near a buy point, volume surges, sell signals, a strength rank, a **setup score**, a sector filter, prices in local currency, EUR or USD, sortable columns and sparklines. |
| **Portfolio** | Enter your holdings or **import a broker CSV** (DEGIRO and most brokers; English, Dutch, French and German headers). You get value, gain/loss, sell signals (7–8% stop, 50/200-day breaks, failed breakouts), volatility, beta and downside beta, risk contribution, a correlation heatmap and a stress replay. |
| **Learn** | All eight bases with diagrams, rules and a live example of each, plus buy/sell rules and a growth checklist. |

**Across the app:**
- **Alerts:** breakout above the buy point (with a volume check), stop (8% under your cost or the buy point), or any price level. Alerts are checked whenever prices load (opening a stock, a scan, the portfolio, or *Check now* in the bell menu); in the iPhone/Mac app a triggered alert also sends a local notification. iOS does not let apps check prices on a timer in the background, so there is no server-side alerting.
- **Watchlists:** several named lists; add a stock to any list from the star button; rename, delete and drag to reorder (Edit in the sidebar).
- **Setup score (0–100):** base 30, strength 25, trend 15, demand 10, earnings 10, market 10; parts without data are left out and the rest is rescaled.
- **Sector ranking:** median strength, share above the 50-day line and near highs per sector, from the latest scan; tap a sector to filter the screener.
- **One currency:** screener and portfolio values in EUR or USD, with live rates in the app and dated reference rates (marked ≈) otherwise.

**Patterns detected:** cup with handle, cup without handle, double bottom, flat base, ascending base, high tight flag, three weeks tight, and descending (faulty) base. Faulty bases are drawn and labelled "(faulty)" rather than hidden.

## Data

- **Built-in data + free live updates** (default, no key): real daily prices for 382 stocks (US, Europe, Japan, Hong Kong, Korea), the Nasdaq, S&P 500, Dow, Euro Stoxx 50 and other indexes, and earnings for 18 researched stocks, taken from the original desk's database (`public/data`, built with `node scripts/build-snapshot.mjs <export-dir>`). In the iPhone/Mac app the newest days, and any other ticker, come from free public chart feeds (Yahoo Finance, Stooq fallback). These are unofficial endpoints: fine for personal use, but check their terms before selling the app.
- **Keeping the snapshot fresh:** `node scripts/patch-bars.mjs file.json` replaces or adds daily bars (`{"^IXIC": [["2026-10-22", o, h, l, c, v]], "NVDA": [...]}`), for example to swap a bar saved during trading hours for the final one. `node scripts/merge-eps.mjs file.json` adds longer quarterly EPS history (adjusted EPS with report dates). Index bars and the US watchlist run through 22 Oct 2026; 36 stocks have EPS history, 18 of them about 5 years.
- **Fictional pattern examples**: 12 made-up companies built to show every pattern (Settings).
- **Real data:** bring your own API key from [Financial Modeling Prep](https://site.financialmodelingprep.com/developer/docs), [Twelve Data](https://twelvedata.com/docs) or [EODHD](https://eodhd.com/financial-apis/). The key stays on the device. Free plans mostly cover US stocks; international listings need paid plans.
- Tickers use Yahoo-style suffixes: `AAPL`, `ASML.AS`, `VOD.L`, `7203.T`, `005930.KS`.
- Prices are cached on the device for 3 hours, and later updates only fetch the new days.
- **Earnings:** FMP (`earnings`, falling back to quarterly income statements), Twelve Data (`earnings`), EODHD (earnings calendar). Coverage depends on the plan.
- **Indexes:** the real index when the plan includes it (FMP `^GSPC`-style symbols, EODHD `.INDX`), otherwise a US-listed ETF that tracks it (SPY, QQQ, EWJ, EWG, FEZ…; non-US ETFs are priced in USD and labelled as such).
- **News** comes straight from free public feeds on the device: Yahoo Finance, Nasdaq.com, Google News, SEC EDGAR, plus FMP/EODHD news when the plan includes it, and your own RSS feeds. Paywalled sites are hidden by default. Browsers block these feeds (CORS), so news shows in the iOS/Mac app, not in `npm run dev`. Set `SEC_CONTACT` in `src/data/news.js` to your support e-mail before release (the SEC asks automated tools to identify themselves).

## Develop

```bash
npm install
npm run dev        # browser preview at http://localhost:5173 (demo mode works fully)
npm test           # detector, analysis, market, portfolio and provider tests
npm run build      # production web build in dist/
```

## Build for iPhone, iPad and Mac (needs a Mac with Xcode 26+)

```bash
npm install
npm run build
npx cap sync ios
npx cap open ios   # opens Xcode
```

In Xcode: choose your Team under *Signing & Capabilities*, then *Product → Archive → Distribute App*. For the Mac App Store, the iPad app can run on Apple-silicon Macs ("Designed for iPad"); see [docs/APP_STORE.md](docs/APP_STORE.md).

## Project layout

```
src/core/       detector (pat.js), indicators, analysis, market status, portfolio maths — pure, tested
src/data/       demo data, providers (FMP, Twelve Data, EODHD), cache/storage, data service
src/ui/         chart component and the six screens
ios/            Capacitor 8 Xcode project (Swift Package Manager)
resources/      icon and splash sources
docs/           App Store checklist, privacy policy, detector notes, store screenshots
test/           node:test suites
```

See [docs/DETECTOR.md](docs/DETECTOR.md) for the detector rules and what changed from the artifact.
