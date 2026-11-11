# Cashflow Compass

A private household cashflow app for **Mac and iPhone**. Track income and expenses for you, your partner and your rental income across **Belfius, KBC, Beobank Mastercard** (and any other account). It reads Dutch screenshots, PDF statements and CSV exports, sorts every line into a category, and suggests where you can spend less so more money can be saved and invested.

The app is in English; the bank text it reads can be Dutch (French and English also work).

## What it does

| Area | Features |
|---|---|
| **Overview** | Income, expenses, money saved and savings rate per month, with comparison to last month · income vs expenses over 12 months · saved per month · where the money went · income sources (you / partner / rental / other) · spending per account · net worth |
| **Import** | Screenshots (PNG/JPG, light or dark mode), PDF statements (text or scanned) and CSV exports. Text recognition (OCR) runs **on the device** with Dutch + English language data. Each line shows up for review: date, description, amount, type, category, account. Possible duplicates are unticked automatically. A balance seen on a screenshot can be saved to the account with one tap. |
| **Smart categories** | About 35 categories with built-in rules for Belgian merchants (Colruyt, Delhaize, Aldi, Lidl, Engie, Fluvius, Proximus, Telenet, NMBS, De Lijn, Shell, Q8 …). When you change a category, the app remembers it for that merchant. |
| **No double counting** | Paying the Beobank card from Belfius or KBC is recognised as a *transfer*, so card purchases are not counted twice. Moving money to savings or investing is also a transfer, not spending. |
| **Manual entry** | Add any income or expense by hand, and choose **which account** the money came from or went to, plus the person (you / partner / joint). |
| **Accounts** | Enter the current balance of each account (a credit card counts as debt). The balance history builds a net-worth chart. |
| **Income & budgets** | Monthly income (your salary, your partner's salary, rental income) and fixed costs, with a one-tap "add this month's items" · budgets per category with progress bars · savings goals with the monthly amount needed |
| **Save & invest** | Suggestions calculated from your own data: savings rate vs target, categories that jumped, subscriptions found, eating out, bank fees and card interest, energy/telecom/insurance checks, emergency fund, pension savings, rental reserve · a "savings ladder" · an investing calculator · category trends |
| **Privacy** | Passcode lock, AES-256 encryption, auto-lock, "hide amounts" button, no server and no tracking (see below) |
| **Backup & sync** | Encrypted backup file. Export on one device, import with **Merge** on the other, to sync between Mac and iPhone. CSV export. |

## Confidentiality: how your data is protected

- **Nothing leaves your device.** There is no server, no account and no analytics. The page's Content-Security-Policy (`connect-src 'self'`) makes the browser block any connection to another website.
- **Encrypted at rest.** All data is stored in the browser's IndexedDB, encrypted with AES-256-GCM. The key comes from your passcode via PBKDF2-SHA256 with 600,000 iterations. The passcode itself is never stored.
- **On-device OCR.** The OCR engine (Tesseract) and the PDF reader (pdf.js) are bundled in `vendor/`, so they are never downloaded from someone else's server. Screenshots and PDFs are **not stored**; only the transactions you approve are saved.
- **Auto-lock** after 5 minutes of inactivity (you can change this). Locking reloads the page, which clears decrypted data from memory.
- ⚠️ **There is no passcode recovery.** If you forget it, the data cannot be decrypted. Make regular backups; the app reminds you.

## Install it on your Mac and iPhone

The app is a *Progressive Web App*: one codebase that installs like an app on both devices and works offline. It must be opened once over **https**. The easiest free option is GitHub Pages:

1. On GitHub, open this repository → **Settings → Pages**.
2. Under *Build and deployment*, choose **Deploy from a branch**, select the branch (e.g. `main` after merging), folder `/ (root)`, and click **Save**.
3. After a minute you get a link like `https://<your-username>.github.io/EmielRepositoryGifthub/`.

> Only the app's **code** is published, never your financial data: that stays encrypted on your devices. If the repository is private, GitHub Pages needs a paid GitHub plan; on a free plan the repository must be public to use Pages. You can also host the folder on any other https web host.

**iPhone:** open the link in **Safari** → tap **Share** → **Add to Home Screen**. Open the app from the Home Screen icon (not from a Safari tab) and create your passcode there.

**Mac (macOS Sonoma or later):** open the link in **Safari** → **File → Add to Dock**. Open the app from the Dock and create your passcode there. Apple's guide: [Use Safari web apps on Mac](https://support.apple.com/en-us/104996).

Each device keeps its **own** encrypted copy. Safari does not copy website storage into a web app when you add it to the Dock, and a Home Screen/Dock app is separate from Safari. Use **Settings → Export encrypted backup**, save the file to iCloud Drive, and on the other device choose **Import / merge backup → Merge**.

## First steps

1. **Income & budgets:** fill in your salary, your partner's salary and the rental income (with the account each one is paid into).
2. **Accounts:** enter today's balance for Belfius, KBC and the Beobank card (and add savings or investment accounts).
3. **Import:** pick the account, then drop screenshots, PDF statements or CSV exports. Check the lines and tap *Save selected*.
4. Check **Save & invest** once a month.

**Tip:** CSV exports from online banking are the most accurate source. Screenshots are convenient, but OCR can misread a character now and then, so always glance at the review list.

## Ideas to save more (built into the app as suggestions)

1. **Pay yourself first:** schedule a standing order to savings/investing on payday instead of saving what is left at the end of the month.
2. **Pay the full credit-card balance** every month. Revolving card interest is very expensive.
3. **Emergency fund** of 3–6 months of expenses on a regulated savings account. In 2026 the interest is tax-free up to €1,020 per person ([KBC](https://www.kbcbrussels.be/retail/en/savings/savings-accounts/tax-on-earnings-from-savings.html)).
4. **Pension savings for both partners:** a tax reduction of 30% on up to €1,050, or 25% on up to €1,350, per person per year (tax year 2026, [Wikifin](https://www.wikifin.be/nl/belasting-werk-en-inkomen/belastingaangifte/belastingverminderingen/pensioensparen)).
5. **Yearly contract check:** compare energy with the [VREG V-test](https://vtest.vreg.be) and telecom with the [BIPT tariff simulator](https://www.bestetarief.be), and ask for insurance quotes.
6. **Subscriptions:** the app lists recurring payments. Cancel or rotate what you don't use weekly.
7. **Invest the rest for the long term**, low-cost and diversified. Since 1 January 2026 Belgium taxes capital gains on financial assets at 10%, with an annual exemption of about €10,000 per person ([KPMG](https://kpmg.com/be/en/insights/my-tax-compass/corporate-tax-insights/the-new-capital-gains-tax-on-financial-assets-in-belgium.html)).

The suggestions are general information, not personal financial advice. Tax figures change every year, so check the linked sources.

## Ideas to improve the app further

- **Automatic bank connection (PSD2 / open banking):** read Belfius, KBC and Beobank transactions directly through a licensed aggregator. This needs a small server and a paid provider, and the data would then pass through that provider, so it trades some privacy for convenience.
- **Native SwiftUI app** with Face ID unlock and iCloud sync (CloudKit), built with Xcode on a Mac. It would run the same logic with Apple's on-device text recognition (Vision).
- **Face ID / Touch ID unlock** in the web app via passkeys (WebAuthn PRF), where Safari supports it.
- **Joint household view:** a fixed monthly contribution from each partner and a "who paid what" balance.
- **Forecasting:** predict the end-of-month balance from recurring items and spending pace.
- **Receipt photos** with line items (groceries by product type).
- **Rental property P&L:** rent minus costs, property tax and maintenance reserve.
- **Investment portfolio tracking** next to the cash accounts.

## For developers

- Plain HTML/CSS/JavaScript modules, no build step. Serve the folder over http(s), e.g. `python3 -m http.server` → http://localhost:8000.
- `js/parser.js`: Dutch/Belgian amount and date parsing, OCR/PDF text → transactions, CSV import
- `js/categorize.js`: merchant rules and learned rules
- `js/insights.js`: analytics and suggestions
- `js/vault.js`: encrypted storage and backups
- `js/importers.js`: OCR (Tesseract.js) and PDF (pdf.js) on the device
- `js/app.js`: the user interface
- Tests: `npm test` (Node 18+)

Bundled libraries: Chart.js 4.5.1 (MIT), pdf.js 5.7.284 (Apache-2.0), Tesseract.js 7.0.0 + tesseract.js-core (Apache-2.0), with Dutch and English `best_int` language data. Licences are in `vendor/`.
