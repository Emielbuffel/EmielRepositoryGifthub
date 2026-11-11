"""Job sources. Each source returns a list of raw job dicts.

Only the Python standard library is used, so GitHub Actions needs no install step.
Every source is independent: if one site is down or changes, the others still work.
"""
import functools
import html
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
TODAY = datetime.now(timezone.utc).date()


def fetch(url, data=None, headers=None, timeout=25, retries=1):
    h = {"User-Agent": UA, "Accept": "*/*", "Accept-Language": "en"}
    if data is not None:
        h["Content-Type"] = "application/json"
        h["Accept"] = "application/json"
        if not isinstance(data, bytes):
            data = json.dumps(data).encode()
    h.update(headers or {})
    last = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, data=data, headers=h)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            last = e
            if e.code in (400, 401, 403, 404, 410, 422):
                break
        except Exception as e:  # network hiccup: retry
            last = e
        time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"{url[:120]} -> {last}")


class Budget:
    """Stops a multi-page source after a number of seconds, keeping what it already has."""
    def __init__(self, seconds):
        self.end = time.time() + seconds

    def over(self):
        return time.time() > self.end


def clean(s):
    s = html.unescape(re.sub(r"<[^>]+>", " ", s or ""))
    return re.sub(r"\s+", " ", s).strip()


def iso(d):
    return d.isoformat() if d else None


def parse_date(s):
    """Best-effort date parser for the many formats the sites use."""
    if not s:
        return None
    s = s.strip()
    s = re.sub(r"\s*\(.*?\)", "", s)
    fmts = ["%Y-%m-%d", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S%z", "%m/%d/%Y %H:%M:%S %p", "%m/%d/%Y",
            "%d/%b/%Y, %I:%M:%S %p", "%b %d, %Y, %I:%M:%S %p", "%d %b %Y - %H:%M", "%d %b %Y",
            "%a, %d %b %Y %H:%M:%S %Z", "%a, %d %b %Y %H:%M:%S %z", "%d %B %Y"]
    for cand in (s, s[:10], re.sub(r" [A-Z]{2,5}$", "", s)):
        for f in fmts:
            try:
                return datetime.strptime(cand, f).date()
            except ValueError:
                pass
    return None


def workday_posted(text):
    t = (text or "").lower()
    if "today" in t:
        return TODAY
    if "yesterday" in t:
        return TODAY - timedelta(days=1)
    m = re.search(r"(\d+)\+? days", t)
    return TODAY - timedelta(days=int(m.group(1))) if m else None


def job(source, sid, title, url, org="", location="", level="", jtype="", category="", posted=None, deadline=None, summary=""):
    return {
        "source": source, "sid": str(sid), "title": clean(title), "url": url, "org": clean(org),
        "location": clean(location), "level": clean(level), "jtype": clean(jtype), "category": clean(category),
        "posted": iso(posted) if not isinstance(posted, str) else posted, "deadline": iso(deadline) if not isinstance(deadline, str) else deadline,
        "summary": clean(summary)[:300],
    }


# ---------------------------------------------------------------- UN Careers (UN Secretariat)
def un_careers():
    xml = fetch("https://careers.un.org/jobfeed")
    root = ET.fromstring(xml.encode())
    out = []
    for it in root.iter("item"):
        title = it.findtext("title") or ""
        link = it.findtext("link") or ""
        desc = it.findtext("description") or ""
        fields = {}
        for part in re.split(r"<br\s*/?>", desc):
            if ":" in part:
                k, v = part.split(":", 1)
                fields[clean(k).lower()] = clean(v)
        org = fields.get("department/office", "")
        # titles look like "UNEP Finance Initiative (UNEP FI) - Senior EU Policy Engagement Expert"
        short = title.split(" - ", 1)[1] if " - " in title else title
        out.append(job("UN Careers", fields.get("job id") or link, short, link, org=org,
                       location=fields.get("duty station", "").title(), level=fields.get("level", ""),
                       category=fields.get("job family", ""), posted=parse_date(fields.get("posted date")),
                       deadline=parse_date(fields.get("deadline"))))
    return out


# ---------------------------------------------------------------- UNjobs.org (aggregates almost all UN agencies + NGOs)
UNJOBS_ITEM = re.compile(
    r'class="jtitle" href="(https://unjobs\.org/vacancies/(\d+))">(.*?)</a><br>(.*?)<br>\s*Updated: <time[^>]*datetime="([^"]+)"', re.S)


@functools.lru_cache(maxsize=None)
def unjobs_page(path):
    body = fetch("https://unjobs.org/" + path)
    return [(m.group(1), m.group(2), m.group(3), m.group(4), m.group(5)) for m in UNJOBS_ITEM.finditer(body)]


def unjobs(pages):
    """pages: {slug: (place label, number of pages)} from profile.json."""
    out, seen, budget = [], set(), Budget(300)
    for slugs, (label, npages) in pages.items():
        if budget.over():
            print("   UNjobs: time limit reached, rest next hour")
            break
        slug = None
        for cand in slugs.split("|"):
            try:
                if unjobs_page(f"duty_stations/{cand}"):
                    slug = cand
                    break
            except Exception:
                pass
            time.sleep(0.5)
        if not slug:
            print(f"   UNjobs {slugs}: no listings found (fine if there are no jobs there right now)")
            continue
        for p in range(1, npages + 1):
            path = f"duty_stations/{slug}" + (f"/{p}" if p > 1 else "")
            try:
                items = unjobs_page(path)
            except Exception as e:
                print(f"   UNjobs {path}: {e}")
                break
            if not items:
                break
            for url, vid, title, org, upd in items:
                if vid in seen:
                    continue
                seen.add(vid)
                t = clean(title)
                loc = label
                # titles often end with ", City" - keep that detail
                m = re.search(r",\s*([^,]{3,40})$", t)
                if m and label.lower() not in m.group(1).lower():
                    loc = f"{m.group(1)}, {label}"
                out.append(job("UNjobs", vid, t, url, org=org, location=loc, posted=parse_date(upd[:10])))
            time.sleep(0.7)
    return out


# ---------------------------------------------------------------- Oracle Recruiting Cloud (UNDP, UNFPA, Save the Children, NRC)
def oracle(name, host, site, org, max_jobs=600):
    out, offset = [], 0
    while offset < max_jobs:
        url = (f"https://{host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true"
               f"&expand=requisitionList.secondaryLocations&finder=findReqs;siteNumber={site},"
               f"limit=100,offset={offset},sortBy=POSTING_DATES_DESC")
        data = json.loads(fetch(url))
        items = (data.get("items") or [{}])[0]
        reqs = items.get("requisitionList") or []
        for r in reqs:
            locs = [r.get("PrimaryLocation") or ""] + [s.get("Name", "") for s in r.get("secondaryLocations") or []]
            out.append(job(name, r["Id"], r.get("Title", ""),
                           f"https://{host}/hcmUI/CandidateExperience/en/sites/{site}/job/{r['Id']}",
                           org=org, location="; ".join(l for l in locs if l), category=r.get("JobFamily") or "",
                           posted=parse_date(r.get("PostedDate")), deadline=parse_date(r.get("PostingEndDate")),
                           summary=r.get("ShortDescriptionStr") or ""))
        total = items.get("TotalJobsCount") or 0
        offset += 100
        if not reqs or offset >= total:
            break
    return out


# ---------------------------------------------------------------- Workday (WFP, UNHCR, World Vision, Global Fund)
def workday(name, host, tenant, site, org, max_jobs=400):
    out, offset = [], 0
    api = f"https://{host}/wday/cxs/{tenant}/{site}/jobs"
    while offset < max_jobs:
        data = json.loads(fetch(api, {"appliedFacets": {}, "limit": 20, "offset": offset, "searchText": ""}))
        posts = data.get("jobPostings") or []
        for p in posts:
            path = p.get("externalPath", "")
            bullets = p.get("bulletFields") or []
            out.append(job(name, bullets[0] if bullets else path, p.get("title", ""),
                           f"https://{host}/en-US/{site}{path}" if "myworkdayjobs" in host else f"https://{host}/recruiting/{tenant}/{site}{path}",
                           org=org, location=p.get("locationsText", ""), jtype=" ".join(bullets[1:]),
                           posted=workday_posted(p.get("postedOn"))))
        offset += 20
        if not posts or offset >= (data.get("total") or 0):
            break
        time.sleep(0.3)
    return out


# ---------------------------------------------------------------- Taleo (FAO, WHO)
def taleo(name, host, section, portal, org, pages=12):
    out = []
    api = f"https://{host}/careersection/rest/jobboard/searchjobs?lang=en&portal={portal}"
    for page in range(1, pages + 1):
        body = {"multilineEnabled": False, "sortingSelection": {"sortBySelectionParam": "3", "ascendingSortingOrder": "false"},
                "fieldData": {"fields": {"KEYWORD": "", "LOCATION": ""}, "valid": True},
                "filterSelectionParam": {"searchFilterSelections": [{"id": "POSTING_DATE", "selectedValues": []}]},
                "advancedSearchFiltersSelectionParam": {"searchFilterSelections": []}, "pageNo": page}
        data = json.loads(fetch(api, body, {"tz": "GMT+01:00", "tzname": "Europe/Rome"}))
        reqs = data.get("requisitionList") or []
        for r in reqs:
            col = r.get("column") or []
            title = col[0] if col else ""
            try:
                locs = json.loads(col[1]) if len(col) > 1 else []
            except Exception:
                locs = [col[1]]
            loc = "; ".join(", ".join(reversed(l.split("-", 1))) if "-" in l else l for l in locs)
            third = parse_date(col[2]) if len(col) > 2 else None
            # FAO shows the closing date in that column, WHO shows the posting date
            posted, deadline = (None, third) if name == "FAO" else (third, None)
            out.append(job(name, r.get("contestNo") or r.get("jobId"), title,
                           f"https://{host}/careersection/{section}/jobdetail.ftl?job={r.get('contestNo')}&lang=en",
                           org=org, location=loc, posted=posted, deadline=deadline))
        paging = data.get("pagingData") or {}
        total = paging.get("totalCount") or 0
        per = paging.get("pageSize") or 25
        if not reqs or page * per >= total:
            break
        time.sleep(0.5)
    return out


# ---------------------------------------------------------------- UNICEF (jobs.unicef.org)
UNICEF_CARD = re.compile(r'<article class="col-12 job-search-results-card-col".*?</article>', re.S)


def unicef(pages=8):
    out = []
    for p in range(1, pages + 1):
        body = fetch(f"https://jobs.unicef.org/jobs/search?page={p}")
        cards = UNICEF_CARD.findall(body)
        for c in cards:
            m = re.search(r'job-search-results-card-title">\s*<a [^>]*href="([^"]+)">(.*?)</a>', c, re.S)
            if not m:
                continue

            def span(cls):
                mm = re.search(r'class="job-component-icon-and-text job-component-' + cls + r'">.*?<span[^>]*>(.*?)</span>', c, re.S)
                return clean(mm.group(1)) if mm else ""

            closing = span("closing-at").replace("Closing at:", "").strip()
            out.append(job("UNICEF", m.group(1).rsplit("/", 1)[-1], m.group(2), m.group(1), org="UNICEF",
                           location=span("location"), level=span("dropdown-field-1"), jtype=span("employment-type"),
                           category=span("category"), deadline=parse_date(closing[:11])))
        if not cards:
            break
        time.sleep(0.7)
    return out


# ---------------------------------------------------------------- Impactpool (UN, NGOs, EU, development banks)
IMPACT_CARD = re.compile(r"<div class='job'>.*?</a></div>", re.S)


def impactpool(queries, pages=2):
    out, seen, budget = [], set(), Budget(150)
    for q in queries:
        if budget.over():
            break
        for p in range(1, pages + 1):
            url = "https://www.impactpool.org/search?" + urllib.parse.urlencode({"q": q, "page": p})
            body = fetch(url)
            cards = IMPACT_CARD.findall(body)
            for c in cards:
                m = re.search(r'href="/jobs/(\d+)"', c)
                t = re.search(r"type='cardTitle'>(.*?)</h3>", c, re.S)
                if not m or not t or m.group(1) in seen:
                    continue
                seen.add(m.group(1))
                bits = [clean(b) for b in re.findall(r"type='bodyEmphasis'>(.*?)</div>", c, re.S)]
                bits = [re.sub(r"\s*<img.*", "", b) for b in bits]
                org = bits[0] if bits else ""
                loc = bits[1] if len(bits) > 1 else ""
                kind = bits[2] if len(bits) > 2 else ""
                out.append(job("Impactpool", m.group(1), t.group(1), f"https://www.impactpool.org/jobs/{m.group(1)}",
                               org=org, location=loc, jtype=kind))
            if not cards:
                break
            time.sleep(0.7)
    return out


# ---------------------------------------------------------------- ReliefWeb (needs a free, approved "appname")
def reliefweb(appname):
    if not appname:
        return []
    body = {"limit": 500, "sort": ["date.created:desc"], "profile": "list",
            "fields": {"include": ["title", "url", "source.shortname", "source.name", "country.name", "city.name",
                                   "date.created", "date.closing", "type.name", "career_categories.name", "experience.name"]}}
    data = json.loads(fetch("https://api.reliefweb.int/v2/jobs?appname=" + urllib.parse.quote(appname), body))
    out = []
    for d in data.get("data", []):
        f = d.get("fields", {})
        src = (f.get("source") or [{}])[0]
        loc = ", ".join([c.get("name", "") for c in f.get("city") or []] + [c.get("name", "") for c in f.get("country") or []])
        out.append(job("ReliefWeb", d.get("id"), f.get("title", ""), f.get("url", ""),
                       org=src.get("shortname") or src.get("name", ""), location=loc or "Home-based / not stated",
                       jtype=", ".join(t.get("name", "") for t in f.get("type") or []),
                       level=", ".join(e.get("name", "") for e in f.get("experience") or []),
                       category=", ".join(c.get("name", "") for c in f.get("career_categories") or []),
                       posted=parse_date((f.get("date") or {}).get("created", "")[:10]),
                       deadline=parse_date((f.get("date") or {}).get("closing", "")[:10])))
    return out


# ---------------------------------------------------------------- SAP SuccessFactors career sites (Enabel, ...)
SF_ROW = re.compile(r'<tr class="data-row">(.*?)</tr>', re.S)


def successfactors(name, base, org, max_rows=300):
    out, seen = [], set()
    for start in range(0, max_rows, 25):
        body = fetch(f"{base}/search/?q=&sortColumn=referencedate&sortDirection=desc&locale=en_US&startrow={start}")
        rows = SF_ROW.findall(body)
        new = 0
        for r in rows:
            m = re.search(r'href="(/job/[^"]+?/(\d+)/)"[^>]*class="jobTitle-link">(.*?)</a>|class="jobTitle-link" href="(/job/[^"]+?/(\d+)/)">(.*?)</a>', r, re.S)
            if not m:
                continue
            path, jid, title = (m.group(1), m.group(2), m.group(3)) if m.group(1) else (m.group(4), m.group(5), m.group(6))
            if jid in seen:
                continue
            seen.add(jid)
            new += 1
            loc = re.search(r'<span class="jobLocation">(.*?)</span>', r, re.S)
            dept = re.search(r'<span class="jobDepartment">(.*?)</span>', r, re.S)
            fac = re.search(r'<span class="jobFacility">(.*?)</span>', r, re.S)
            date = re.search(r'<span class="jobDate[^"]*">(.*?)</span>', r, re.S)
            out.append(job(name, jid, title, base + path, org=org, location=loc.group(1) if loc else "",
                           jtype=dept.group(1) if dept else "", category=fac.group(1) if fac else "",
                           posted=parse_date(clean(date.group(1))) if date else None))
        if not rows or not new or len(rows) < 25:
            break
        time.sleep(0.5)
    return out


# ---------------------------------------------------------------- Belgian FPS Foreign Affairs (diplomatie.belgium.be)
NL_MONTHS = {"januari": 1, "februari": 2, "maart": 3, "april": 4, "mei": 5, "juni": 6, "juli": 7, "augustus": 8,
             "september": 9, "oktober": 10, "november": 11, "december": 12}


def parse_nl_date(text):
    m = re.search(r"(\d{1,2}) (" + "|".join(NL_MONTHS) + r") (\d{4})", text.lower())
    if not m:
        return None
    try:
        return datetime(int(m.group(3)), NL_MONTHS[m.group(2)], int(m.group(1))).date()
    except ValueError:
        return None


def belgian_foreign_affairs():
    page = "https://diplomatie.belgium.be/nl/werken-voor-fod-buitenlandse-zaken/vacatures"
    body = fetch(page)
    out = []
    for sec in re.findall(r'<section class="\s*highlighted-text.*?</section>', body, re.S):
        t = re.search(r'<h2 class="highlighted-text__title">(.*?)</h2>', sec, re.S)
        if not t or "<li>" not in sec:
            continue
        items = [clean(li) for li in re.findall(r"<li>(.*?)</li>", sec, re.S)]
        info = {i.split(":", 1)[0].strip().lower(): i.split(":", 1)[1].strip() for i in items if ":" in i}
        link = re.search(r'href="(https?://[^"]+)"', sec)
        deadline = next((parse_nl_date(i) for i in items if "tot en met" in i), None)
        title = clean(t.group(1))
        out.append(job("Belgian Foreign Affairs", title, title, html.unescape(link.group(1)) if link else page,
                       org="FPS Foreign Affairs (Belgium)", location="Brussels, Belgium",
                       level=("Level " + info["niveau"]) if info.get("niveau") else "", jtype=info.get("type", ""),
                       deadline=deadline))
    return out


# ---------------------------------------------------------------- Flemish government (vlaanderen.be, incl. FIT and Flemish diplomacy)
FLEMISH_KEEP = re.compile(r"flanders investment|\bfit\b|buitenland|foreign affairs|buitenlandse|diplomat|diplomaa|attach[eé]|"
                          r"vertegenwoordig|ambassade|embassy|internationa|kanselarij|europe|europ[ae]", re.I)


def flemish_government(max_pages=30):
    out = []
    api = "https://www.vlaanderen.be/api/overview-search"
    for page in range(max_pages):
        data = json.loads(fetch(api, {"page": {"offset": page, "limit": 100}, "filter": {"contentType": {"IN": ["Job"]}},
                                      "resolverContext": {"language": "nl"}}))
        items = data.get("items") or []
        for it in items:
            ident = it.get("identifier") or it.get("link", "")
            org = it.get("hiringOrganization") or ""
            title = it.get("displayTitle") or ""
            desc = (it.get("description") or {}).get("raw", "")
            # the list also carries thousands of VDAB jobs (schools, shops): keep the Flemish government's own
            # vacancies and anything international or diplomatic
            if not (str(ident).startswith("cornerstone") or FLEMISH_KEEP.search(f"{org} {title}")):
                continue
            cities = sorted({(l.get("address") or {}).get("city") or "" for l in it.get("embeddedLocations") or []} - {""})
            vt = str(it.get("validThroughDate") or "")
            deadline = None
            if vt.isdigit() and len(vt) >= 12:
                deadline = datetime.fromtimestamp(int(vt) / 1000, timezone.utc).date()
            elif vt and vt != "-1":
                deadline = parse_date(vt[:10])
            out.append(job("Flemish government", ident, title, "https://www.vlaanderen.be" + it.get("link", ""),
                           org=org or "Vlaamse overheid", location=(", ".join(cities) + ", Belgium") if cities else "Belgium",
                           level=((it.get("degreeLevel") or {}).get("name") or ""), category=it.get("domain") or "",
                           deadline=deadline, summary=desc))
        if not items or data.get("isLastPage"):
            break
        time.sleep(0.3)
    return out


def all_sources(profile, reliefweb_appname=""):
    """Return {source name: callable}."""
    pages = {k: tuple(v) for k, v in profile.get("unjobs_pages", {}).items()}
    return {
        "UN Careers": un_careers,
        "UNjobs": lambda: unjobs(pages),
        "FAO": lambda: taleo("FAO", "jobs.fao.org", "fao_external", "8105120163", "FAO"),
        "WHO": lambda: taleo("WHO", "careers.who.int", "ex", "101430233", "WHO"),
        "UNDP": lambda: oracle("UNDP", "estm.fa.em2.oraclecloud.com", "CX_1", "UNDP"),
        "UNFPA": lambda: oracle("UNFPA", "estm.fa.em2.oraclecloud.com", "CX_2003", "UNFPA"),
        "UNICEF": unicef,
        "WFP": lambda: workday("WFP", "wfp.wd3.myworkdayjobs.com", "wfp", "job_openings", "WFP"),
        "UNHCR": lambda: workday("UNHCR", "unhcr.wd3.myworkdayjobs.com", "unhcr", "External", "UNHCR"),
        "Save the Children": lambda: oracle("Save the Children", "hcri.fa.em2.oraclecloud.com", "CX_1", "Save the Children International"),
        "NRC": lambda: oracle("NRC", "ekum.fa.em2.oraclecloud.com", "CX_2019", "Norwegian Refugee Council"),
        "World Vision": lambda: workday("World Vision", "worldvision.wd1.myworkdayjobs.com", "worldvision", "WorldVisionInternational", "World Vision International"),
        "Global Fund": lambda: workday("Global Fund", "theglobalfund.wd1.myworkdayjobs.com", "theglobalfund", "External", "The Global Fund"),
        "Belgian Foreign Affairs": belgian_foreign_affairs,
        "Flemish government": flemish_government,
        "Enabel": lambda: successfactors("Enabel", "https://jobs.enabel.be", "Enabel (Belgian development agency)"),
        "Impactpool": lambda: impactpool(profile.get("impactpool_queries", [])),
        "ReliefWeb": lambda: reliefweb(reliefweb_appname),
    }
