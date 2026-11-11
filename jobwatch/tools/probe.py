"""Second probe: dump raw samples so the parsers can be written against real data."""
import json, re, urllib.request, concurrent.futures as cf

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"


def req(url, data=None):
    h = {"User-Agent": UA, "Accept": "*/*", "Accept-Language": "en"}
    if data is not None:
        h["Content-Type"] = "application/json"; h["Accept"] = "application/json"
    try:
        with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=h), timeout=30) as r:
            return r.status, r.read(2_000_000).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read(3000).decode("utf-8", "replace")
    except Exception as e:
        return -1, repr(e)


def around(body, pat, before=200, after=2500, n=1):
    out = []
    for m in list(re.finditer(pat, body))[:n]:
        out.append(body[max(0, m.start() - before): m.start() + after])
    return "\n...\n".join(out) or "(pattern not found) " + body[:1500]


ORA = "https://{host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations&finder=findReqs;siteNumber={site},limit=2,offset=0,sortBy=POSTING_DATES_DESC"
WD = json.dumps({"appliedFacets": {}, "limit": 2, "offset": 0, "searchText": ""}).encode()

tasks = {
    "unjobs-geneva": lambda: (lambda s, b: f"{s}\n" + around(b, r"<div class=\"job\"|class=\"jtitle\"|<a class=\"jtitle", 300, 3000, 2) + "\nPAGER:" + around(b, r"duty_stations/geneva/", 200, 400))(*req("https://unjobs.org/duty_stations/geneva")),
    "unjobs-new": lambda: (lambda s, b: f"{s}\n" + b[8000:14000])(*req("https://unjobs.org/New/1")),
    "unvacancies-feed": lambda: (lambda s, b: f"{s} len={len(b)} items={b.count('<item')}\n" + b[:3000])(*req("https://unvacancies.org/feed.xml")),
    "enabel-feed": lambda: (lambda s, b: f"{s} items={b.count('<item')}\n" + around(b, r"<item", 0, 2500))(*req("https://www.enabel.be/jobs/feed/")),
    "unicef": lambda: (lambda s, b: f"{s} len={len(b)}\n" + around(b, r"/jobs/[a-z0-9-]{20,}", 1500, 2500, 1) + "\nNEXT:" + around(b, r"page=2|next", 300, 300))(*req("https://jobs.unicef.org/jobs/search")),
    "undp-oracle": lambda: (lambda s, b: f"{s}\n" + around(b, r"\"requisitionList\"", 0, 5000))(*req(ORA.format(host="estm.fa.em2.oraclecloud.com", site="CX_1"))),
    "unfpa-oracle": lambda: (lambda s, b: f"{s}\n" + around(b, r"TotalJobsCount", 0, 100))(*req(ORA.format(host="estm.fa.em2.oraclecloud.com", site="CX_2003"))),
    "stc-oracle": lambda: (lambda s, b: f"{s}\n" + around(b, r"TotalJobsCount", 0, 100))(*req(ORA.format(host="hcri.fa.em2.oraclecloud.com", site="CX_1"))),
    "nrc-oracle": lambda: (lambda s, b: f"{s}\n" + around(b, r"TotalJobsCount", 0, 100))(*req(ORA.format(host="ekum.fa.em2.oraclecloud.com", site="CX_2019"))),
    "wv-workday": lambda: (lambda s, b: f"{s}\n" + b[:600])(*req("https://worldvision.wd1.myworkdayjobs.com/wday/cxs/worldvision/WorldVisionInternational/jobs", WD)),
    "gf-workday": lambda: (lambda s, b: f"{s}\n" + b[:600])(*req("https://theglobalfund.wd1.myworkdayjobs.com/wday/cxs/theglobalfund/External/jobs", WD)),
    "wfp-detail": lambda: (lambda s, b: f"{s}\n" + b[:2500])(*req("https://wd3.myworkdaysite.com/wday/cxs/wfp/job_openings/job/Rome-Italy/Financial-Business-System-Analyst--P3-_JR128308")),
    "rescue-site": lambda: (lambda s, b: f"{s}\n" + b[:800])(*req("https://careers.rescue.org/")),
    "iom-careers": lambda: (lambda s, b: f"{s}\n" + " | ".join(sorted(set(re.findall(r"https?://[a-z0-9.-]*(?:oraclecloud|myworkday|taleo|successfactors)[^\"' <>]*", b))))[:800])(*req("https://careers.iom.int/")),
    "unops": lambda: (lambda s, b: f"{s}\n" + b[:800])(*req("https://jobs.unops.org/Pages/ViewVacancy/VAListing.aspx")),
    "impactpool": lambda: (lambda s, b: f"{s}\n" + around(b, r"/jobs/\d{5,}", 1200, 1500))(*req("https://www.impactpool.org/search?q=evaluation")),
    "fao-taleo": lambda: (lambda s, b: f"{s}\n" + b[:1500])(*req("https://jobs.fao.org/careersection/rest/jobboard/searchjobs?lang=en&portal=8105120231", json.dumps({"multilineEnabled": False, "sortingSelection": {"sortBySelectionParam": "3", "ascendingSortingOrder": "false"}, "fieldData": {"fields": {"KEYWORD": "", "LOCATION": ""}, "valid": True}, "filterSelectionParam": {"searchFilterSelections": []}, "advancedSearchFiltersSelectionParam": {"searchFilterSelections": []}, "pageNo": 1}).encode())),
    "fao-portal": lambda: (lambda s, b: f"{s}\n" + " | ".join(sorted(set(re.findall(r"portal[=:\"' ]+\d{6,}", b))))[:400])(*req("https://jobs.fao.org/careersection/fao_external/jobsearch.ftl?lang=en")),
    "who-portal": lambda: (lambda s, b: f"{s}\n" + " | ".join(sorted(set(re.findall(r"portal[=:\"' ]+\d{6,}", b))))[:400])(*req("https://careers.who.int/careersection/ex/jobsearch.ftl")),
}

with cf.ThreadPoolExecutor(10) as ex:
    futs = {k: ex.submit(f) for k, f in tasks.items()}
    for k, f in futs.items():
        try:
            r = f.result()
        except Exception as e:
            r = repr(e)
        print(f"\n######## {k}\n{r}")
