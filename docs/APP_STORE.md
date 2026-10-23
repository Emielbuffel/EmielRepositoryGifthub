# Publishing Base Pattern Desk on the App Store

A checklist from a Mac to a live listing, plus ready-to-paste store texts. Rules checked against Apple's App Review Guidelines (developer.apple.com/app-store/review/guidelines) in October 2026. Re-check them before you submit, because Apple updates them.

## 1. Things only you can do

- [ ] **Apple Developer Program** membership ($99/year). See the note under "Risks" about enrolling as an **organization** rather than an individual.
- [ ] A **Mac with Xcode 26 or newer**. Capacitor 8 requires it, and its iOS deployment target is 15.0.
- [ ] Pick the final **bundle ID**. The placeholder is `com.basepatterndesk.app` in `capacitor.config.json` and in the Xcode target. Change both if you use your own domain, e.g. `com.yourname.basepatterndesk`.
- [ ] **Host the privacy policy** at a public URL. App Store Connect requires one. The text is ready in [PRIVACY.md](PRIVACY.md); GitHub Pages works.
- [ ] A **support URL**. A GitHub page or a simple contact page is enough.

## 2. Build and upload

```bash
npm install && npm run build && npx cap sync ios && npx cap open ios
```

1. Xcode → target **App** → *Signing & Capabilities* → choose your Team (automatic signing).
2. *General* → check version **1.0.0**, build **1**. Raise the build number for every upload.
3. Run on a real iPhone and iPad once (also try airplane mode in demo mode).
4. *Product → Archive* → *Distribute App* → *App Store Connect* → *Upload*.
5. In App Store Connect, create the app (name, bundle ID, SKU, primary language English) and attach the build.

### Mac App Store

The simplest route: in App Store Connect → the app → *Pricing and Availability*, keep **"Make this app available on Mac (Apple silicon)"** switched on. The iPad version then runs on M-series Macs as "Designed for iPad", with no extra build. The app has a sidebar layout for wide windows.

A native Mac Catalyst build (Xcode → target → *General* → *Supported Destinations* → add *Mac Catalyst*) is possible, but Capacitor doesn't officially support it. Test it carefully if you want it.

## 3. App Store Connect answers

| Field | Answer |
|---|---|
| Category | Finance (secondary: Education) |
| Age rating | 4+; no objectionable content. Answer "No" to gambling, contests and unrestricted web access. |
| Price | Your choice (free, or paid up front). Don't add in-app purchases without updating the app. |
| **App Privacy ("nutrition label")** | **Data Not Collected.** The app has no analytics, no account and no tracking. Prices are fetched from the provider the user picks, with the user's own key. News feeds are requested directly from the device, with only the ticker or company name. |
| Encryption (export compliance) | Uses only standard HTTPS. `ITSAppUsesNonExemptEncryption = NO` is already in Info.plist. |
| Content rights | The app shows data that users fetch with their own provider accounts. It bundles no third-party market data; the demo data is synthetic. |
| Sign-in required? | No |

### Review notes (paste into "Notes for the reviewer")

> Base Pattern Desk is an educational charting tool. It does not trade, hold money, connect to brokerages or give personal advice. On first launch it runs in **Demo mode** with fictional companies and synthetic prices, so every feature can be tested without an account or network access: Chart, Market, Screener, Portfolio and Learn. Real market data is optional. Users enter their own API key from a market-data provider (Financial Modeling Prep, Twelve Data or EODHD) in Settings. The key stays on the device. The Learn tab's "See an example" buttons open demo stocks that show each chart pattern.

## 4. Store listing text

**Name (30):** Base Pattern Desk
**Subtitle (30):** O'Neil chart patterns & signals

**Promotional text (170):**
Spot cups with handles, flat bases and double bottoms automatically, with buy points, volume checks and O'Neil's sell rules. Try it free in demo mode.

**Description:**
Base Pattern Desk finds the chart bases William O'Neil described in How to Make Money in Stocks, and explains them.

PATTERNS, DRAWN FOR YOU
• Eight bases: cup with handle, cup without handle, double bottom, flat base, ascending base, high tight flag, three weeks tight and descending base
• Each pattern in its own colour, current and past, with the outcome of every breakout
• Buy point, 5% buy zone, 7–8% stop and profit targets
• Faulty bases (too short, V-shaped, loose handle) are flagged, not hidden

PRO CHARTING
• Smooth 4-quarter EPS line with a dot at every report, coloured by year-over-year growth
• Compare with the S&P 500, Nasdaq, Nikkei 225, DAX, Euro Stoxx 50, FTSE 100, KOSPI and more, or a sector ETF
• RS line against the index of your choice, with a dot at new highs
• Earnings table with surprises and the next report date

NEWS, ALWAYS FRESH
• Headlines from free sources and official SEC filings, checked every time you open a stock
• Paywalled sites filtered out; add your own RSS feeds

A CHECKLIST, NOT A GUESS
• Signal with an 11-point O'Neil checklist
• CAN SLIM overview, RS line, up/down volume, base stage
• Flags for breakouts, failed breakouts, 50/200-day crosses and volume surges
• Draw your own trend lines, levels, zones and cups; the app watches them

MARKET DIRECTION
• Distribution days and follow-through days on the major indexes
• Confirmed uptrend / under pressure / correction, with IBD's exposure guideline

SCREENER
• Scan your watchlist, portfolio or your own list for breakouts, buy points and volume surges

PORTFOLIO RISK
• Sell signals for your holdings, volatility, downside beta, risk contribution, hidden correlations and a stress replay

PRIVATE BY DESIGN
• No account, no tracking, no ads. Your lists and holdings stay on your device.
• Demo mode works offline. For real prices, connect your own key from Financial Modeling Prep, Twelve Data or EODHD.

Base Pattern Desk is an educational tool that applies published rules of thumb to end-of-day prices. It is not investment advice. CAN SLIM is a registered trademark of Investor's Business Daily; this app is not affiliated with IBD or William O'Neil + Co.

**Keywords (100):** stock,chart,pattern,oneil,canslim,cup,handle,breakout,base,screener,technical,analysis,investing

## 5. Screenshots

Ready-made screenshots from demo mode are in [`app-store-screenshots/`](app-store-screenshots/):

- iPhone 6.9" (1320 × 2868): chart, market, screener, portfolio, learn
- iPad 13" (2064 × 2752): the same five screens. These are also used for the Mac listing ("Designed for iPad").

Apple requires screenshots that show the real app. These come from the actual build running in demo mode. You can also take your own in the simulator (*File → Save Screen*).

## 6. Risks to know about (honest assessment)

1. **Guideline 5.1.1(ix): regulated fields.** Apple says apps "in highly regulated fields (such as banking and financial services…)" should come from a legal entity, not an individual. The guideline aims at apps that *provide* financial services. This app provides none: no trading, no accounts, no advice. Developer-forum reports show reviewers sometimes apply it to finance-related apps anyway. **Lower the risk:** enroll as an organization if you can. Keep the "educational, not advice" wording, and the review note above, which explains that no financial service is provided.
2. **Guideline 3.2.1(viii):** apps "used for financial trading, investing, or money management" should come from the financial institution. This app doesn't execute trades or manage money; it's an analysis and education tool. The review note says so.
3. **Guideline 5.2.2: third-party data.** The app doesn't bundle or resell market data. Users fetch it with their own accounts, under each provider's terms. The old artifact used unofficial Naver/onvista endpoints. They were removed on purpose, because a published app would need permission to use them.
4. **News feeds (also guideline 5.2.2).** The app reads public RSS feeds on the user's device and shows only headline, source and a link to the original article, like an RSS reader. It doesn't copy article text or host anything. Some feed owners say their feeds are for personal, non-commercial use: Google News did in older terms, and Yahoo has been removing feeds. The safest sources are SEC EDGAR (public government data) and the news APIs in the user's own FMP/EODHD plan. Every source has its own switch in Settings. If you charge for the app and want to be careful, switch Google News and Yahoo off by default (`newsSettings()` in `src/data/news.js`), or ask those services for permission. Set `SEC_CONTACT` in `src/data/news.js` to your support e-mail.
5. **Guideline 4.2: minimum functionality.** The app runs fully offline in demo mode, bundles all its code (no remote website) and has native-style navigation. That's well beyond "a repackaged website".
6. **Not verified here:** the build was produced on Linux. Xcode compiling, signing and running on devices still needs to be done on a Mac. The live provider APIs couldn't be called from the build machine (network policy), so the parsers are tested against the documented response formats. Test each provider with a real key before you submit.
