# Base Pattern Desk

O'Neil-style stock charting for **iPhone, iPad and Mac**. The app finds William O'Neil's base patterns automatically and draws each one in its own colour, with the buy point, the volume checks and the sell rules. It also shows the market direction (distribution and follow-through days), runs a screener on the device, and reviews the risk of your portfolio.

This is a standalone rebuild of the "Base Pattern Desk" claude.ai artifact. That version only worked inside claude.ai: it relied on the page database, the FMP connector and Claude's scheduled tasks. This version runs entirely on the device and can be published on the App Store.

> Educational tool. Not investment advice.

## What's in the app

| Tab | What it does |
|---|---|
| **Chart** | Daily/weekly candles, 10/21/50/200-day lines, RS line, volume, RSI and MACD. Every detected base is drawn in its own colour, both the current base and every past one (with its outcome). A strip under the chart lists them all; tap one to jump to it. Also: base card with buy point and plan, signal + 11-point checklist, CAN SLIM, flags, key numbers, base history, and your own drawings (trend line, level, zone, your own cup, note). |
| **Market** | Nasdaq, S&P 500, Dow and Euro Stoxx 50 with distribution days (D), follow-through days (FTD), the market status and IBD's exposure guideline. |
| **Screener** | Scans your watchlist, portfolio, a US large-cap list or your own list: breakouts, stocks near a buy point, volume surges, sell signals, an RS rank, sortable columns and sparklines. |
| **Portfolio** | Enter your holdings. You get value, gain/loss, O'Neil sell signals (7–8% stop, 50/200-day breaks, failed breakouts), volatility, beta and downside beta, risk contribution, a correlation heatmap and a stress replay. |
| **Learn** | All eight bases with diagrams, rules and a live example of each, plus buy/sell rules and CAN SLIM. |

**Patterns detected:** cup with handle, cup without handle, double bottom, flat base, ascending base, high tight flag, three weeks tight, and descending (faulty) base. Faulty bases are drawn and labelled "(faulty)" rather than hidden.

## Data

- **Demo mode** (default): 12 fictional companies and 2 fictional indexes. They are generated so that every pattern appears. No account or internet needed, so App Review can test everything.
- **Real data:** bring your own API key from [Financial Modeling Prep](https://site.financialmodelingprep.com/developer/docs), [Twelve Data](https://twelvedata.com/docs) or [EODHD](https://eodhd.com/financial-apis/). The key stays on the device. Free plans mostly cover US stocks; international listings need paid plans.
- Tickers use Yahoo-style suffixes: `AAPL`, `ASML.AS`, `VOD.L`, `7203.T`, `005930.KS`.
- Prices are cached on the device for 3 hours, and later updates only fetch the new days.

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
