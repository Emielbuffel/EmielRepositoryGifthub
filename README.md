# Base Pattern Desk

A **personal desktop app** (Mac and Windows) for base-pattern stock charting. It finds classic chart bases (cups, flat bases, double bottoms and more) automatically and draws each one in its own colour, with the buy point, the volume checks and the sell rules. It also shows the market direction (distribution and follow-through days), screens about 2,000 stocks worldwide plus every US-listed company, and reviews the risk of your portfolio.

This is a standalone rebuild of the "Base Pattern Desk" claude.ai artifact, which needed the claude.ai page database and Claude's nightly scheduled tasks for its data. The desktop app gets its data itself from free public feeds, so it works on its own. It is meant for **personal use only**: the free feeds (Yahoo Finance, Stooq) and the bundled price snapshot are not licensed for a commercial app.

> Educational tool. Not investment advice.

## Install on your computer

**Mac:** download `Base-Pattern-Desk-mac-AppleSilicon.zip` (M1/M2/M3/M4 Macs) or `Base-Pattern-Desk-mac-Intel.zip` (older Macs; Apple menu → About This Mac shows which you have). Double-click the zip and drag **Base Pattern Desk** to your Applications folder.
The app is not notarized by Apple (that needs a paid developer account), so the first time macOS blocks it:
1. Open it once (macOS shows a warning, click Done/Cancel).
2. Go to **System Settings → Privacy & Security**, scroll down and click **Open Anyway** next to "Base Pattern Desk", then confirm.
If macOS says the app "is damaged", open Terminal and run `xattr -cr "/Applications/Base Pattern Desk.app"`, then open it again.

**Windows:** unzip `Base-Pattern-Desk-1.0.0-win-x64.zip` anywhere and run `Base Pattern Desk.exe` (Windows SmartScreen: More info → Run anyway).

**Build it yourself** (any computer with Node.js 20+): `npm install`, then `npm run desktop` to run it, or `npm run dist:mac` / `npm run dist:win` to make the zip files in `release/`.

Your watchlists, holdings, alerts and the price cache are stored in the app's own folder on your computer (`~/Library/Application Support/Base Pattern Desk` on a Mac).

## Where the data comes from (desktop app)

| What | Source | How far back |
|---|---|---|
| Daily prices, any ticker worldwide | Yahoo Finance chart feed (Stooq as a fallback); a built-in snapshot works offline | The chart loads the **whole history** (decades for older companies); scans use 2 years |
| US earnings (EPS, sales) | **SEC EDGAR** company facts: GAAP diluted EPS from every 10-Q/10-K, adjusted for stock splits (split dates from the chart feed), Q4 = full year minus Q1–Q3 | XBRL filings start in **2009–2011** |
| Adjusted EPS + report dates | Built-in for 36 stocks (18 with ~5 years); used when it covers more quarters, or when you pick "Adjusted EPS only" in the EPS menu | 2021+ |
| Non-US earnings | Yahoo fundamentals feed | Usually only the last 4–6 quarters |
| Stock universe | The original desk's universe (S&P 500, Nasdaq-100, STOXX Europe 600, Japan, Hong Kong, Korea large caps) + its search directory = 1,978 stocks; plus the SEC list of all Nasdaq/NYSE companies (~5,000) | |
| News | Yahoo Finance, Nasdaq.com, Google News, SEC filings (RSS) | |

SEC EDGAR asks automated tools to identify themselves: add your e-mail in **Settings → Market data** (it is only sent to sec.gov). The desktop app checks alerts every 30 minutes while it is open and shows a system notification when one triggers.

## What's in the app

| Tab | What it does |
|---|---|
| **Chart** | **EPS line** (4-quarter or quarterly, smooth, a dot per report coloured by y/y growth). **Compare** with the home index (S&P 500, Nasdaq, Nikkei 225, DAX, Euro Stoxx 50, FTSE 100, KOSPI…), MSCI World or a US sector ETF, rebased to the left edge; the RS line can use any of these indexes. Earnings table with surprises and the next report date, growth checklist, accumulation grade, liquidity, and **news** from free sources, refreshed every time you open a stock. Daily/weekly candles, 10/21/50/200-day lines, RS line, volume, RSI and MACD. Every detected base is drawn in its own colour, both the current base and every past one (with its outcome). A strip under the chart lists them all; tap one to jump to it. Also: base card with buy point and plan, signal + 11-point checklist, growth checklist, setup score (0–100), flags, key numbers, base history, and your own drawings (trend line, level, zone, your own cup, note). |
| **Trade plan** (stock page, any base with a buy point) | How much to buy and when: Buy 1 = 50% of the position on a close above the buy point on volume ≥ 1.4× average, Buy 2 = 35% at +1–2%, Buy 3 = 15% at +4–5%, nothing above the 5% buy zone — each with the amount, the share count (converted with the live exchange rate) and the price range. Protection: the 7% stop (most you can lose), the failed-breakout exit, the stop raised to just under the buy point at +15% and to breakeven at +20%. Profits: ⅓ at +20%, ⅓ at +25% on the average price, the last ⅓ held while above the 50-day line; the book's 8-week rule when +20% comes within 3 weeks. The buying-plan sheet tracks each step with your real fills, and alerts fire for every buy, sale and stop. |
| **Volume** (stock page) | Under the price: today's volume against the 50-day average, the week so far against an average week, and (while the market is open) an estimate of the full day's volume. In the chart's volume pane: a label with the bar's volume and its % against the average, the 50-day (weekly chart: 10-week) average as an orange line with its value on the axis, and days at least 40% above the average in full colour. The data panel adds last week, the 10-week average, the up/down volume ratio (buying vs selling), the volume a breakout needs, and a small chart of the last 10 weeks plus this week. The watchlist shows each stock's volume against its average. |
| **Automatic** (desktop app) | No Refresh button needed: watchlists and holdings update about every 90 seconds while their market is open (every 30 minutes otherwise), the open chart every minute, the Market tab every 5 minutes, and the screener rescans by itself (every 30 minutes by default, Settings → Market data). The screener shows only stocks in a pattern by default, and opening a stock on the chart updates its screener row, so both always agree. |
| **Notifications for your stocks** | Stocks you own: a notification when one breaks out of a new base into its buy zone, nears a new buy point, or reaches an add-on point (three weeks tight, a quiet first or second pullback to the rising 50-day line, a quiet pullback to the rising 21-day line for strong leaders) — only while the position shows a gain (average up, never down). Watchlist stocks: a notification when they break out into a buy zone (can be switched off). |
| **Position size from your account** | The portfolio value is worked out by the app: your holdings at today's prices (converted to your currency) plus your cash (negative cash = a margin loan). A position is a fixed share of it (20% by default), so it grows and shrinks with the account. The number of positions follows from the size and the market: 100% invested ÷ 20% = 5; with margin (up to 50% of your own money, only in a confirmed uptrend) 150% = 7; under pressure 60% = 3; in a correction 20% = 1. The trade plan shows how a new position would be paid (cash first, then margin), the margin after the buy and what a 10% fall would cost; the Sell ideas tab says when to pay margin back. A fixed number can still be chosen in Settings → Buying plan. |
| **Margin by market phase** | Margin only in a confirmed uptrend, including a new one right after a follow-through day (up to your limit, 50% of your own money by default). During a rally attempt in a correction: no buys and no margin yet. Uptrend under pressure: no new margin, pay the loan back. Correction: no margin, close the positions bought on margin, at most 20% invested; buy signals are paused. A notification arrives whenever the market phase changes. |
| **Dividends & taxes** | Upload DEGIRO account statements as PDF (or CSV), check how each line was read and correct it, then see per year: dividends gross, tax withheld, net, the Belgian stock-exchange tax (TOB), costs and margin interest; dividends per stock and per country of the company (from the ISIN), and every tax and cost line. Files are read on the device; re-uploading overlapping periods doesn't double-count. |
| **Capital gains (10% tax)** | On the Dividends & taxes tab: realised gains per year from your DEGIRO buys and sells — shares bought before 2026 start from their 31-12-2025 closing price (or the higher real average price for sales up to 2030), the average purchase price for several buys, losses offsetting gains, the EUR 10,000 exemption, and the estimated 10% tax to declare. |
| **Trade review** | Every closed trade with win rate, average win against average loss, holding time of winners and losers, losses deeper than the stop, and which entries worked (a breakout bought in the buy zone, a chase past +5%, an early entry, no base) — from the chart at the day of your first buy. |
| **Earnings filter** | The screener looks up the next earnings date of every stock in a pattern and hides those reporting within your no-buy window (14 days by default), with an Earnings column. |
| **Sync** | Watchlists, holdings, cash, plans, journal, statements, alerts and drawings stay the same on the Mac app, the iPhone app and the page on claude.ai: through a private GitHub Gist (token with only the gist permission) and, on claude.ai, your private storage of the page. A joining device takes the synced data first. |
| **On claude.ai / iPhone Home Screen** | The page uses your own FMP connector for live US prices (the FMP Basic plan has no other markets) and the built-in data for the rest. A scheduled task refreshes those built-in prices every weekday evening (23:41 Brussels time): `node scripts/refresh-snapshot.mjs`, `npx vite build`, `node scripts/build-artifact.mjs OUT`, then publish OUT to the page. |
| **Tell the coach your trades** | In the Coach chat, type what you did — “bought 50 NVDA at 182.30 yesterday”, “Gisteren 100 UCB gekocht aan 180,5 euro, kosten 3 euro”, “sold half of my ASML at 640”, “bought 25 Microsoft for 12,500 dollar”. The coach reads it (English or Dutch, several trades in one message, names or tickers, prices per share or in total, other currencies converted), shows each trade to check and correct, and on “Add to my holdings” updates the holding (shares and average cost) and the trade journal. With your Anthropic key, messy messages are read by Claude first. |
| **All stocks on the page** | The page on claude.ai keeps its own price data: long history in 64 files, the last weeks in 8 small files, and the screener rows worked out every evening (`node scripts/page-data.mjs DIR`). The evening task adds up to 300 more stocks of the app's list (S&P 500, Nasdaq-100, STOXX Europe 600, Japan, Hong Kong, Korea, China) each night until all ~1,980 are in, plus any stock you ask for with **Add to the built-in data** on the page (it is there the next morning and updated every evening after that). Prices come from Yahoo Finance's free daily feed. |
| **What the company is** | Under each stock's name: its industry and one sentence on what it does (from the company profile; for the built-in stocks stored in `meta.json` by `node scripts/add-profiles.mjs`). The screener shows the industry under the name and the sentence when you point at it. |
| **Sell ideas** | The stocks you own, weakest first: hard sell rules first (a loss past your stop, a falling 200-day line, a failed breakout, a heavy-volume 50-day break), then a 0–100 keep score from strength vs the market, trend, 3-month change, progress over 8 weeks, your gain and accumulation/distribution. Says how many to sell to get back within your limit (8 by default, Settings → Buying plan), which stock to sell first when you need room, and which stronger stocks from your last scan could take their place. |
| **Watchlists** | Several named lists as tabs in the sidebar, plus a "My stocks" tab for your holdings and "+ New" to create a list; the screener can scan any list or all of them. |
| **Live prices** (desktop app) | Yahoo Finance's regular-session price and day change (the same as Yahoo's headline), pre-market and after-hours prices separately, and today's price and volume refreshed about every minute while the market is open. |
| **Market** | Nasdaq, S&P 500, Dow and Euro Stoxx 50 with distribution days (D), follow-through days (FTD), a day-by-day status ribbon, base patterns on the indexes, a list of every distribution day in the count, market headlines, a rule-of-thumb exposure guide and a **sector ranking** from the latest scan. "Analyse & draw" opens an index in the full chart, where you can draw and see all its patterns. |
| **Screener** | Scans all 382 built-in stocks, a watchlist, your portfolio or your own list: breakouts, stocks near a buy point, volume surges, sell signals, a strength rank, a **setup score**, a sector filter, prices in local currency, EUR or USD, sortable columns and sparklines. |
| **O'Neil Coach** | A chat (header ☺ button or Coach on the stock page) that answers "what would O'Neil do?" from Emiel's playbook (CAN SLIM + the webinar rules + the back-test + Buffett's moat test) and the app's live numbers. Offline it answers by rules; with your own Anthropic API key (Settings → Coach) it holds full conversations with Claude (key stays on the device, sent only to api.anthropic.com). |
| **Fundamentals** (stock page) | Revenue and net profit, gross/operating/net margins, operating cash flow, capital spending and free cash flow, debt versus cash, per quarter, trailing 12 months or per year, with a short reading under each chart. Sources: SEC EDGAR filings for US companies (back to about 2009) and the free Yahoo feed for others in the desktop app; an FMP key also works in the web version. Refreshed daily; a "new results" alert appears when a new quarter is filed (holdings and watchlists are checked once a day). |
| **Company** (stock page) | What the company does, sector and industry, market value, P/E, return on equity (book: 17%+), shares and float, management and institutional ownership (fills the "I" of the growth checklist), short interest, analysts' target. Desktop app: Yahoo Finance; web version: FMP key or the built-in name and sector. |
| **Portfolio** | Enter your holdings or **import a broker CSV** (DEGIRO and most brokers; English, Dutch, French and German headers). You get value, gain/loss, sell signals (7–8% stop, 50/200-day breaks, failed breakouts), volatility, beta and downside beta, risk contribution, a correlation heatmap and a stress replay. **Account:** cash (negative = margin) with a stocks/cash donut and how much is invested; deposits and withdrawals; the **evolution of the account** in money and as a time-weighted % return (deposits and withdrawals left out), with max drawdown and the S&P 500; **composition** of the stocks by sector, region and currency; **factor analysis** (beta, volatility, momentum, distance from highs, RS, and in the desktop app a regression on market, size, value, momentum, quality and low-volatility ETFs). **Import several files at once:** monthly holdings files (each becomes a dated snapshot; the date comes from the file name or from matching the closing prices) and the account statement (DEGIRO Account.csv: deposits, withdrawals, trades, dividends, dividend tax, costs, taxes, interest). The evolution is then exact on every statement date, and a **Dividends, costs and taxes** section shows totals, a monthly chart, a table per year and dividends per stock. |
| **Learn** | All eight bases with diagrams, rules and a live example of each, plus buy/sell rules and a growth checklist. |

**Your buying and selling plan (from the webinar notes):**
- **Buying plan per stock** (Plan button on the chart): equal-size positions (default 20% of 208,000 EUR = 41,600 EUR), bought as a pyramid inside the buy zone: 50% at the breakout, 35% at +1–2%, 15% at +4–5%; stop 7% below the buy point (5–8% range); follow-on buys at a rising 50-day line. Amounts, share counts (converted from the listing currency) and the levels on the chart. All numbers are editable in Settings → Buying plan.
- **Plan alerts**: a notification and a bell entry when buy 1, add 2, add 3, a 50-day add or the stop becomes due. No buy alerts within 14 days before an earnings report (dates from the built-in data or Yahoo's calendar in the desktop app); a warning when the market is under pressure or in a correction.
- **Trade journal** ("keep folders of all buys and sells"): every buy and sell with reasons and notes, also updating your holdings; round trips with average buy/sell and result, win/loss averages, CSV export, buy/sell markers on the chart, and *Review chart* to go back to any past trade.
- **Portfolio checks**: positions above the target size, the weakest position bigger than the best one ("shift money from losers into leaders"), positions past the stop.
- **Exposure checklist** on the Market tab: the factors for increasing exposure (indexes rising on volume, near highs, above support and moving averages, breakouts working, strong days, follow-through day) and for reducing it (leaders breaking down, extended stocks, outsized down days, distribution days and clustering, stalling, weak rally attempts), measured from the Nasdaq, S&P 500 and your last scan; news reactions are your own Yes/No. Shows **Raise cash!** when distribution days pile up together with breaking leaders or outsized down days.
- **Daily routine**: market checked, plans checked, watchlist current, journal up to date; earnings coming up for your holdings and plans; **leaders you missed** (strength 90+, near highs, not on your lists) with one-click add.
- **Backup / restore** of all your data (Settings), and ↑/↓ (or J/K) to page through the watchlist charts.

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
- **FMP key as a backup:** with the free data selected, an FMP key (Settings → Data) is used only for US tickers the free data cannot load (e.g. the factor ETFs in the web version, or when the free feed is down). FMP's free Basic plan: 250 requests a day, about 5 years of end-of-day prices.
- **Earnings:** FMP (`earnings`, falling back to quarterly income statements), Twelve Data (`earnings`), EODHD (earnings calendar). Coverage depends on the plan.
- **Indexes:** the real index when the plan includes it (FMP `^GSPC`-style symbols, EODHD `.INDX`), otherwise a US-listed ETF that tracks it (SPY, QQQ, EWJ, EWG, FEZ…; non-US ETFs are priced in USD and labelled as such).
- **News** comes straight from free public feeds on the device: Yahoo Finance, Nasdaq.com, Google News, SEC EDGAR, plus FMP/EODHD news when the plan includes it, and your own RSS feeds. Paywalled sites are hidden by default. Browsers block these feeds (CORS), so news shows in the iOS/Mac app, not in `npm run dev`. Set `SEC_CONTACT` in `src/data/news.js` to your support e-mail before release (the SEC asks automated tools to identify themselves).

## Develop

```bash
npm install
npm run dev        # browser preview at http://localhost:5173 (demo mode works fully)
npm test           # detector, analysis, market, portfolio and provider tests
npm run build      # production web build in dist/
npm run desktop    # build and open the desktop app (Electron)
```

## Optional: iPhone/iPad build (needs a Mac with Xcode 26+)

The Capacitor iOS project is kept for running the app on your own iPhone or iPad from Xcode (a free Apple ID can install it on your own device for 7 days at a time). It is not set up for the App Store any more.

```bash
npm install
npm run build
npx cap sync ios
npx cap open ios   # opens Xcode
```

In Xcode: choose your Team under *Signing & Capabilities* and press Run with your device connected. [docs/APP_STORE.md](docs/APP_STORE.md) keeps the earlier App Store notes for reference.

## Project layout

```
src/core/       detector (pat.js), indicators, analysis, market status, portfolio maths — pure, tested
src/data/       providers (free feeds, FMP, Twelve Data, EODHD), SEC EDGAR, network layer, cache, data service
src/ui/         chart component and the six screens
desktop/        Electron main process (app:// origin, CORS-free requests) and preload
ios/            Capacitor 8 Xcode project (optional)
resources/      icon and splash sources
docs/           App Store checklist, privacy policy, detector notes, store screenshots
test/           node:test suites
```

See [docs/DETECTOR.md](docs/DETECTOR.md) for the detector rules and what changed from the artifact.
