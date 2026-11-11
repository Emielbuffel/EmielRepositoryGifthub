"""Probe candidate job-source endpoints and print what they return.

Used once on GitHub Actions to find out which sources answer with usable data.
"""
import json, re, ssl, sys, urllib.request, concurrent.futures as cf

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"

GET = [
    "https://careers.un.org/jobfeed",
    "https://reliefweb.int/jobs/rss.xml",
    "https://reliefweb.int/jobs/rss.xml?search=evaluation",
    "https://api.reliefweb.int/v2/jobs?appname=jobwatch-probe&limit=1",
    "https://api.reliefweb.int/v1/jobs?appname=jobwatch-probe&limit=1",
    "https://unjobs.org/duty_stations/geneva",
    "https://unjobs.org/countries/switzerland",
    "https://unjobs.org/new",
    "https://untalent.org/jobs",
    "https://untalent.org/jobs/rss",
    "https://untalent.org/feed",
    "https://www.unjobnet.org/jobs",
    "https://www.impactpool.org/search",
    "https://unvacancies.org/jobs/recent/geneva",
    "https://jobs.unicef.org/en-us/listing/",
    "https://jobs.unicef.org/en-us/listing/rss",
    "https://jobs.unicef.org/en-us/search/?search-keyword=evaluation",
    "https://estm.fa.em2.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations&finder=findReqs;siteNumber=CX_1,limit=3,sortBy=POSTING_DATES_DESC",
    "https://jobs.ilo.org/services/rss/job/?locale=en_US&keywords=()",
    "https://careers.unesco.org/services/rss/job/?locale=en_US&keywords=()",
    "https://jobs.fao.org/careersection/fao_external/joblist.ftl",
    "https://www.fao.org/employment/vacancies/en",
    "https://careers.who.int/careersection/ex/jobsearch.ftl",
    "https://www.ifad.org/en/careers",
    "https://www.ifad.org/en/web/guest/job-opportunities",
    "https://www.unhcr.org/what-we-do/careers",
    "https://www.iom.int/jobs",
    "https://www.unfpa.org/jobs",
    "https://jobs.unops.org/",
    "https://www.wfp.org/careers/job-openings",
    "https://www.unwomen.org/en/about-us/employment",
    "https://app.unv.org/",
    "https://www.icrc.org/en/careers",
    "https://careers.ifrc.org/",
    "https://www.adb.org/work-with-us/careers",
    "https://www.spc.int/vacancies",
    "https://www.sprep.org/job-vacancies",
    "https://www.icimod.org/careers/",
    "https://gggi.org/careers/",
    "https://www.worldbank.org/en/about/careers",
    "https://eu-careers.europa.eu/en/job-opportunities/open-for-application",
    "https://www.wwf.org/careers",
    "https://www.iucn.org/about-iucn/careers",
    "https://www.cgiar.org/careers/",
    "https://www.rescue.org/careers",
    "https://www.savethechildren.net/careers",
    "https://www.nrc.no/career/",
    "https://www.msf.org/work-msf",
    "https://www.oxfam.org/en/jobs",
    "https://jobs.oxfam.org.uk/",
    "https://www.wvi.org/careers",
    "https://www.care-international.org/careers",
    "https://www.theglobalfund.org/en/careers/",
    "https://www.gavi.org/our-alliance/work-us",
    "https://www.unep.org/about-un-environment/careers",
    "https://www.unescap.org/jobs",
    "https://www.unitar.org/about/careers",
    "https://unu.edu/careers",
    "https://www.itcilo.org/jobs",
    "https://www.wmo.int/about-us/careers",
    "https://www.intracen.org/about-us/careers",
    "https://www.giz.de/en/jobs/giz_job_opportunities.html",
    "https://www.enabel.be/jobs/",
]

WORKDAY = [
    ("https://wd3.myworkdaysite.com/wday/cxs/wfp/job_openings/jobs"),
    ("https://wfp.wd3.myworkdayjobs.com/wday/cxs/wfp/job_openings/jobs"),
    ("https://unhcr.wd3.myworkdayjobs.com/wday/cxs/unhcr/External/jobs"),
    ("https://iom.wd3.myworkdayjobs.com/wday/cxs/iom/IOM/jobs"),
    ("https://rescue.wd1.myworkdayjobs.com/wday/cxs/rescue/rescue_careers/jobs"),
    ("https://savethechildren.wd3.myworkdayjobs.com/wday/cxs/savethechildren/External/jobs"),
]

ATS = re.compile(r"https?://[a-z0-9.-]*(myworkdayjobs\.com|myworkdaysite\.com|oraclecloud\.com|taleo\.net|successfactors\.(?:com|eu)|pageuppeople\.com|smartrecruiters\.com|greenhouse\.io|lever\.co|csod\.com|icims\.com|jobs\.[a-z.]+|recruitee\.com|teamtailor\.com|bamboohr\.com|personio\.(?:de|com)|workable\.com)[^\s\"'<>)]*", re.I)
FEED = re.compile(r"<link[^>]+(?:rss|atom)[^>]*>", re.I)


def req(url, data=None):
    headers = {"User-Agent": UA, "Accept": "*/*", "Accept-Language": "en"}
    if data is not None:
        headers["Content-Type"] = "application/json"
        headers["Accept"] = "application/json"
    r = urllib.request.Request(url, data=data, headers=headers)
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            body = resp.read(600_000).decode("utf-8", "replace")
            return resp.status, resp.headers.get("Content-Type", ""), resp.geturl(), body
    except urllib.error.HTTPError as e:
        try:
            body = e.read(4000).decode("utf-8", "replace")
        except Exception:
            body = ""
        return e.code, e.headers.get("Content-Type", "") if e.headers else "", url, body
    except Exception as e:
        return -1, "", url, repr(e)


def summarize(url, status, ctype, final, body):
    out = [f"### {url}", f"status={status} type={ctype} final={final} len={len(body)}"]
    if "xml" in ctype or body.lstrip().startswith("<?xml") or "<rss" in body[:500]:
        items = re.findall(r"<item>.*?</item>", body, re.S)
        out.append(f"RSS items={len(items)}")
        if items:
            out.append(items[0][:1500])
    elif "json" in ctype:
        out.append(body[:1500])
    else:
        t = re.search(r"<title>(.*?)</title>", body, re.S)
        out.append("title=" + (t.group(1).strip()[:120] if t else "?"))
        feeds = set(FEED.findall(body))
        if feeds:
            out.append("feeds=" + " | ".join(list(feeds)[:5]))
        ats = sorted(set(m.group(0)[:160] for m in ATS.finditer(body)))
        if ats:
            out.append("ats=" + " | ".join(ats[:12]))
        if status != 200:
            out.append(body[:300].replace("\n", " "))
    return "\n".join(out)


def probe_get(url):
    return summarize(url, *req(url))


def probe_wd(url):
    payload = json.dumps({"appliedFacets": {}, "limit": 2, "offset": 0, "searchText": ""}).encode()
    return summarize("POST " + url, *req(url, payload))


with cf.ThreadPoolExecutor(12) as ex:
    futs = [ex.submit(probe_get, u) for u in GET] + [ex.submit(probe_wd, u) for u in WORKDAY]
    for f in futs:
        print(f.result())
        print()
