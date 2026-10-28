# iPhone, iPad and automatic updates (Apple only, no App Store)

There are two ways to have Base Pattern Desk on your iPhone or iPad. You need neither for the Mac app.

| Way | Live data | Updates | Needs |
|---|---|---|---|
| **A. Home Screen app from your own free website** (recommended) | ✓ through the website's data relay | automatic | a free Cloudflare account, once |
| **B. Native app built with Xcode** | ✓ direct | rebuild from Xcode | your Mac with Xcode and an Apple ID |

Your watchlists, holdings, journal and settings stay on each device. Use **Settings → Back up my data** on one
device and **Restore a backup** on another to copy them (for example via iCloud Drive or AirDrop).

---

## A. Your own free website (Cloudflare Pages) — once, about 10 minutes

The website serves the newest version of the app, lets your iPhone and iPad install it on the Home Screen, gives
that version live data (Yahoo Finance, SEC EDGAR, news) through a small relay, and tells the Mac app when there is an
update. Every time new code is pushed to GitHub, Cloudflare rebuilds the site by itself.

1. Create a free account at **dash.cloudflare.com** (no credit card needed for the free plan).
2. Go to **Workers & Pages → Create → Pages → Connect to Git**, allow access to GitHub and choose the repository
   **EmielRepositoryGifthub**.
3. Build settings:
   - Production branch: `main` (or the branch with the newest app, `claude/eloquent-darwin-17z1xx`)
   - Framework preset: **None**
   - Build command: `npm run build`
   - Build output directory: `dist`
4. Under **Environment variables** add:
   - `NODE_VERSION` = `22`
   - `RELAY_KEY` = a password you make up (type: secret). It stops other people from using your relay.
5. **Save and Deploy.** After 1–3 minutes you get an address like `https://base-pattern-desk.pages.dev`.
6. In the Mac app: **Settings → Phone & automatic updates**, enter the address and the relay key, press
   **Save and test**.

### Put it on your iPhone or iPad
1. Open the address in **Safari**.
2. Tap **Share** (the square with the arrow) → **Add to Home Screen** → **Add**.
3. Open the app from the new icon (full screen, no browser bars).
4. In the app: **Settings → Phone & automatic updates** → enter the relay key → **Save and test**.

The Home Screen app works offline with the data it has seen and updates itself: when a new version is on the website
it installs it in the background and reloads. Price alerts show inside the app (a website can't send iPhone
notifications without a push server).

### Mac app updates
With the address saved in Settings, the Mac app checks the website at start and every 3 hours, downloads a new build
(checking every file's SHA-256) and asks you to restart. Only a change to the app shell itself needs a new download;
Settings tells you when.

### Limits (free plan)
Cloudflare's free plan allows 500 builds a month and, for the relay, about 100,000 requests a day — plenty for one
person. Keep the address to yourself: there is no personal data on the site, but the relay and the built-in data are.

---

## B. Native iPhone/iPad app with Xcode

On your Mac with Xcode installed:

1. In the project folder: `npm install`, then `npm run ios` (builds the app and opens it in Xcode).
2. Connect your iPhone, choose it at the top of Xcode.
3. **Signing & Capabilities → Team**: choose your Apple ID (add it under Xcode → Settings → Accounts).
4. Press **Run**. The first time, on the iPhone: Settings → General → VPN & Device Management → trust your developer
   profile.

With a free Apple ID the app must be re-installed from Xcode every 7 days; with a paid Apple Developer account
(99 USD a year) it lasts a year. The native app does not update itself: repeat `npm run ios` + Run for a new version
(it tells you when your website has a newer build).
