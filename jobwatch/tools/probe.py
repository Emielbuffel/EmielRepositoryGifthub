"""Third probe: page structures for HTML sources and Taleo."""
import json, re, urllib.request, concurrent.futures as cf

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"


def req(url, data=None, extra=None):
    h = {"User-Agent": UA, "Accept": "*/*", "Accept-Language": "en"}
    if data is not None:
        h["Content-Type"] = "application/json"; h["Accept"] = "application/json"
    h.update(extra or {})
    try:
        with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=h), timeout=30) as r:
            return r.status, r.read(3_000_000).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read(3000).decode("utf-8", "replace")
    except Exception as e:
        return -1, repr(e)


def around(body, pat, before=200, after=2500, n=1):
    ms = list(re.finditer(pat, body))
    out = [f"(matches={len(ms)})"]
    for m in ms[:n]:
        out.append(body[max(0, m.start() - before): m.start() + after])
    return "\n...\n".join(out) if ms else "(pattern not found) len=%d" % len(body)


def taleo(host, portal):
    body = json.dumps({"multilineEnabled": False, "sortingSelection": {"sortBySelectionParam": "3", "ascendingSortingOrder": "false"},
                       "fieldData": {"fields": {"KEYWORD": "", "LOCATION": ""}, "valid": True},
                       "filterSelectionParam": {"searchFilterSelections": [{"id": "POSTING_DATE", "selectedValues": []}]},
                       "advancedSearchFiltersSelectionParam": {"searchFilterSelections": []}, "pageNo": 1}).encode()
    s, b = req(f"https://{host}/careersection/rest/jobboard/searchjobs?lang=en&portal={portal}", body, {"tz": "GMT+01:00", "tzname": "Europe/Rome"})
    return f"{s}\n{b[:3000]}"


tasks = {
    "unjobs-gva": lambda: (lambda s, b: f"{s}\n" + around(b, r"<article|class=\"jtitle|class='jtitle|/vacancies/\d", 400, 1800, 2))(*req("https://unjobs.org/duty_stations/gva")),
    "unjobs-new": lambda: (lambda s, b: f"{s}\n" + around(b, r"/vacancies/\d", 600, 1500, 2))(*req("https://unjobs.org/New/1")),
    "unjobs-ph": lambda: (lambda s, b: f"{s}\n" + around(b, r"/vacancies/\d", 0, 200, 1))(*req("https://unjobs.org/duty_stations/philippines")),
    "fao-taleo": lambda: taleo("jobs.fao.org", "8105120163"),
    "who-taleo": lambda: taleo("careers.who.int", "101430233"),
    "unicef-p2": lambda: (lambda s, b: f"{s}\n" + around(b, r"job-component-list-employment_type", 0, 2500) + "\nPAGINATION:" + around(b, r"pagination|page=", 200, 800))(*req("https://jobs.unicef.org/jobs/search?page=2")),
    "impactpool": lambda: (lambda s, b: f"{s}\n" + around(b, r"<div class='job'>", 0, 2500, 1))(*req("https://www.impactpool.org/search?q=evaluation")),
    "unvacancies": lambda: (lambda s, b: f"{s}\n" + around(b, r"<item>", 0, 1500, 2))(*req("https://unvacancies.org/feed.xml")),
    "iom": lambda: (lambda s, b: f"{s}\n" + b[:600])(*req("https://careers.iom.int/")),
    "iom2": lambda: (lambda s, b: f"{s}\n" + " | ".join(sorted(set(re.findall(r"https?://[a-z0-9.-]*(?:oraclecloud|myworkday|taleo|successfactors|iom\.int)[^\"' <>]*", b))))[:1000])(*req("https://www.iom.int/careers")),
    "ilo": lambda: (lambda s, b: f"{s}\n" + around(b, r"jobTitle|data-row|class=\"jobTitle", 300, 1500))(*req("https://jobs.ilo.org/search/?q=&sortColumn=referencedate&sortDirection=desc")),
    "ifad": lambda: (lambda s, b: f"{s}\n" + b[:500])(*req("https://job.ifad.org/")),
    "adb": lambda: (lambda s, b: f"{s}\n" + b[:300])(*req("https://www.adb.org/work-with-us/careers/job-openings")),
    "unescap-links": lambda: (lambda s, b: f"{s}\n" + around(b, r"careers.un.org|inspira", 300, 500))(*req("https://www.unescap.org/jobs")),
}

with cf.ThreadPoolExecutor(10) as ex:
    futs = {k: ex.submit(f) for k, f in tasks.items()}
    for k, f in futs.items():
        try:
            r = f.result()
        except Exception as e:
            r = repr(e)
        print(f"\n######## {k}\n{r}")
