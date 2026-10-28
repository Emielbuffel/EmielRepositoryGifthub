# Phone, web and automatic updates (no App Store)

There are three ways to have Base Pattern Desk on your phone. You need none of them to use the desktop app.

| Way | iPhone | Android | Live data | Updates |
|---|---|---|---|---|
| **A. Web app from your own free website** (recommended) | ✓ | ✓ | ✓ through the website's data relay | automatic |
| **B. Android app (APK) built by GitHub** | — | ✓ | ✓ direct | install the new APK (data stays) |
| **C. iPhone app built with Xcode** | ✓ | — | ✓ direct | rebuild from Xcode |

Your watchlists, holdings, journal and settings stay on each device. Use **Settings → Back up my data** on one device and **Restore a backup** on another to copy them.

---

## A. Your own free website (Cloudflare Pages) — once, about 10 minutes

The website serves the newest version of the app, lets your phone install it, gives the web version live data
(Yahoo Finance, SEC EDGAR, news) through a small relay, and tells the desktop app when there is an update.
Every time new code is pushed to GitHub, Cloudflare rebuilds the site by itself.

1. Create a free account at **dash.cloudflare.com** (no credit card needed for the free plan).
2. Go to **Workers & Pages → Create → Pages → Connect to Git**, allow access to GitHub and choose the repository
   **EmielRepositoryGifthub**.
3. Settings for the build:
   - Production branch: `main` (or the branch with the newest app)
   - Framework preset: **None**
   - Build command: `npm run build`
   - Build output directory: `dist`
4. Under **Environment variables** add:
   - `NODE_VERSION` = `22`
   - `RELAY_KEY` = a password you make up (type: secret). It stops other people from using your relay.
5. **Save and Deploy.** After 1–3 minutes you get an address like `https://base-pattern-desk.pages.dev`.
6. Open the address on your computer: the app opens. In **Settings → Phone & automatic updates**, enter the address
   and the relay key, and press **Save and test**.

### Install it on your phone
- **iPhone (Safari):** open the address → **Share** → **Add to Home Screen**. Open it from the new icon.
- **Android (Chrome):** open the address → menu ⋮ → **Install app** (or **Add to Home screen**).
- In the app on the phone: **Settings → Phone & automatic updates** → enter the relay key → **Save and test**.

The app on the phone works offline with the data it has seen, and updates itself: when a new version is on the
website it installs it in the background and reloads.

### Desktop app updates
With the address saved in Settings, the desktop app checks the website at start and every 3 hours, downloads a
new build (checking every file's SHA-256), and asks you to restart. Only a change to the desktop shell itself needs a
new download of the app; Settings tells you when.

### Limits (free plan)
Cloudflare's free plan allows 500 builds a month and, for the relay, about 100,000 requests a day — plenty for one
person. Keep the address to yourself: the app has no personal data on the site, but the relay and the built-in data are
on it.

---

## B. Android app (APK)

1. Every push to the repository builds the APK on GitHub (Actions → **Build apps**).
2. On your phone, open github.com → the repository → **Releases → Latest build** and download
   `Base-Pattern-Desk-android.apk`.
3. Open it and allow installing apps from your browser once. Updates install over the old version; your data stays.

## C. iPhone app with Xcode (free Apple ID)

On your Mac with Xcode: `npm install`, then `npm run ios`. In Xcode choose your iPhone, sign with your Apple ID
(Signing & Capabilities → Team) and press Run. With a free Apple ID the app must be re-installed from Xcode every
7 days; with a paid Apple Developer account it lasts a year.
