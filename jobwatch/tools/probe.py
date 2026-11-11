"""Probe Belgian / Flemish diplomacy job sources (temporary)."""
import re, urllib.request, concurrent.futures as cf
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
def req(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "nl,en"}), timeout=30) as r:
            return r.status, r.geturl(), r.headers.get("Content-Type",""), r.read(3_000_000).decode("utf-8","replace")
    except urllib.error.HTTPError as e:
        return e.code, url, "", e.read(2000).decode("utf-8","replace")
    except Exception as e:
        return -1, url, "", repr(e)
URLS = [
 "https://jobs.enabel.be/services/rss/job/?locale=en_US&keywords=()",
 "https://jobs.enabel.be/services/rss/job/?locale=fr_FR",
 "https://jobs.enabel.be/search/?q=&sortColumn=referencedate&sortDirection=desc",
 "https://www.vlaanderen.be/werken-voor-vlaanderen/vacatures",
 "https://www.vlaanderen.be/werken-voor-vlaanderen/vacatures/vacatures-zoeken",
 "https://www.flandersinvestmentandtrade.com/nl/over-ons/jobs",
 "https://www.flandersinvestmentandtrade.com/en/about-us/jobs",
 "https://www.flandersinvestmentandtrade.com/nl/jobs",
 "https://werkenvoor.be/nl/vacatures",
 "https://werkenvoor.be/nl/vacatures?search=buitenlandse%20zaken",
 "https://travaillerpour.be/fr/vacatures",
 "https://diplomatie.belgium.be/nl/werken-voor-fod-buitenlandse-zaken",
 "https://www.eeas.europa.eu/eeas/vacancies_en",
 "https://www.eeas.europa.eu/eeas/vacancies_en?f%5B0%5D=vacancy_type%3A",
 "https://www.egmontinstitute.be/about-us/vacancies/",
 "https://www.vlaanderen.be/buitenland/werken-bij-departement-buitenland",
]
PAT = re.compile(r'href="([^"]*(?:/job/|/Job/|vacature|vacancy|vacancies|cornerstone|jobdetail)[^"]*)"[^>]*>(.{0,140}?)<', re.I | re.S)
def run(u):
    s, final, ct, b = req(u)
    out = [f"### {u}", f"status={s} final={final} type={ct} len={len(b)}"]
    if "<item" in b: out.append("RSS items=%d\n%s" % (b.count("<item"), b[b.find("<item"):b.find("<item")+1200]))
    else:
        t = re.search(r"<title>(.*?)</title>", b, re.S); out.append("title=" + (t.group(1).strip()[:100] if t else "?"))
        links = []
        for m in PAT.finditer(b):
            txt = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", m.group(2))).strip()
            links.append(f"{m.group(1)[:140]} :: {txt[:80]}")
        out.append("links=%d\n  " % len(links) + "\n  ".join(dict.fromkeys(links).keys().__iter__().__class__ and list(dict.fromkeys(links))[:12]))
        apis = sorted(set(re.findall(r"https?://[a-z0-9.-]+/[^\"' ]*(?:api|graphql|search|json)[^\"' ]{0,80}", b)))[:8]
        if apis: out.append("api-ish: " + " | ".join(apis))
        if s != 200: out.append(b[:300])
    return "\n".join(out)
with cf.ThreadPoolExecutor(8) as ex:
    for r in ex.map(run, URLS): print(r, "\n")
