# Job watch

Every hour this looks for new vacancies at the UN and big NGOs, keeps the ones that fit your CV, and sends an alert to your phone when a good one opens in one of your places.

It runs for free on GitHub Actions, so your computer does not need to be on.

## What it checks

| Source | What it covers |
|---|---|
| [UN Careers](https://careers.un.org) | UN Secretariat: OCHA, UNEP, UNOG Geneva, ESCAP, DESA, regional commissions |
| [UNjobs.org](https://unjobs.org) | Almost every UN agency (incl. IFAD, ILO, IOM, UNOPS, UN Women, UNESCO) plus many NGOs, read per country |
| [FAO](https://jobs.fao.org) and [WHO](https://careers.who.int) | Their own job boards |
| [UNDP](https://estm.fa.em2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1) and [UNFPA](https://www.unfpa.org/jobs) | Their own job boards |
| [UNICEF](https://jobs.unicef.org/jobs/search) | Its own job board |
| [WFP](https://wfp.wd3.myworkdayjobs.com/job_openings) and [UNHCR](https://unhcr.wd3.myworkdayjobs.com/External) | Their own job boards |
| [Impactpool](https://www.impactpool.org) | Searches for evaluation, GIS, geospatial, M&E, remote sensing, research analyst |
| Save the Children, NRC, World Vision, Global Fund | Their own job boards |
| [ReliefWeb](https://reliefweb.int/jobs) | Off until you add a free app name (see below) |

The list of places is in `profile.json`: Geneva, Brussels, Rome, Bhutan, Nepal, the Philippines, Fiji, New Zealand, Australia, Indonesia, Japan and the Pacific islands, plus "home-based" jobs.

## 1. Get the phone alerts (2 minutes)

1. Install the free **ntfy** app: [Android](https://play.google.com/store/apps/details?id=io.heckel.ntfy) or [iPhone](https://apps.apple.com/app/ntfy/id1625396347).
2. Tap **+** (subscribe to topic) and type the topic name from `profile.json` → `ntfy_topic`.
3. Done. Each new matching vacancy arrives as a notification. Tap it to open the job ad.

You can also read the alerts in a browser at `https://ntfy.sh/<your topic>`.

## 2. See the dashboard

`dashboard.html` in this folder is rebuilt after every run. It has filters for place, job type (international staff, national officer, consultancy, JPO, UNV …), organisation, CV match and how new the job is. You can star jobs.

To open it: Actions tab → latest **Job watch** run → download **dashboard** → open the file in your browser.

## 3. Change what you get

Edit `profile.json` on GitHub (open the file, click the pencil, then "Commit changes"):

- `notify_locations`: places that send a phone alert.
- `locations`: the place names and city names that are recognised.
- `keywords`: words from your CV with a weight. A word in the job title counts double.
- `min_score_to_notify`: raise it (for example to 8) for fewer, stronger alerts.
- `exclude_title`: jobs with these words in the title never send an alert.
- `unjobs_pages`: the UNjobs.org country pages that are read every hour.

## Optional extras

Add these under **Settings → Secrets and variables → Actions** in the GitHub repository:

- `RELIEFWEB_APPNAME`: turns on ReliefWeb (many NGO jobs). ReliefWeb now needs an approved app name; request one for free on the [ReliefWeb API page](https://apidoc.reliefweb.int/).
- `SMTP_USER`, `SMTP_PASSWORD`, `ALERT_EMAIL_TO`: an email for each batch of new matches. For Gmail, `SMTP_PASSWORD` is an [app password](https://support.google.com/accounts/answer/185833), not your normal password.
- `NTFY_TOPIC`: use this instead of the topic in `profile.json` if you want to keep it out of the file.

## Good to know

- The check runs every hour. GitHub sometimes starts scheduled runs some minutes late.
- The schedule only runs from the repository's main branch.
- A private repository gets 2,000 free GitHub Actions minutes per month. One run takes about 1 to 2 minutes, so one run per hour fits.
- When a website changes its layout, that one source can stop working. The others keep going. Each run lists the sources and how many jobs each gave (Actions tab → run → summary), and the dashboard shows it at the bottom.
- Some sites (IFAD, IOM, UN Women, ADB, SPREP, UNOPS) block automated reading. Their jobs still come in through UNjobs.org and Impactpool.
