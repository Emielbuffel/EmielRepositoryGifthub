"""Probe 3 (temporary)."""
import re, json, urllib.request, concurrent.futures as cf
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
def req(url, data=None):
    h = {"User-Agent": UA, "Accept-Language": "nl,en", "Accept": "application/json, text/html, */*"}
    if data is not None: h["Content-Type"] = "application/json"
    try:
        with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=h), timeout=30) as r:
            return r.status, r.geturl(), r.read(4_000_000).decode("utf-8","replace")
    except urllib.error.HTTPError as e:
        return e.code, url, e.read(800).decode("utf-8","replace")
    except Exception as e:
        return -1, url, repr(e)
def links(label, url, pat=r'(?i)vacat|job|attach|functie|medewerker|adviseur|career|successfactors|werken'):
    s, f, b = req(url)
    ls = []
    for m in re.finditer(r'<a [^>]*href="([^"]+)"[^>]*>(.*?)</a>', b, re.S):
        t = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", m.group(2))).strip()
        if re.search(pat, m.group(1) + " " + t): ls.append(f"{m.group(1)[:170]} :: {t[:90]}")
    return f"### {label} status={s} final={f} len={len(b)}\n  " + "\n  ".join(list(dict.fromkeys(ls))[:40])
def show(label, url, data=None, n=1500):
    s, f, b = req(url, data)
    return f"### {label} {url}\nstatus={s} len={len(b)}\n{b[:n]}"
tasks = [
 lambda: links("FIT werken-voor-fit", "https://corporate.flandersinvestmentandtrade.com/nl/werken-voor-fit"),
 lambda: links("FIT working-fit", "https://corporate.flandersinvestmentandtrade.com/en/working-fit"),
 lambda: links("diplomatie vacatures", "https://diplomatie.belgium.be/nl/werken-voor-fod-buitenlandse-zaken/vacatures"),
 lambda: show("vl overview-search GET", "https://www.vlaanderen.be/api/overview-search"),
 lambda: show("vl overview-search POST", "https://www.vlaanderen.be/api/overview-search", json.dumps({"query": "", "type": "vacature"}).encode()),
 lambda: show("vl siteapi", "https://www.vlaanderen.be/api/siteapi", n=800),
 lambda: show("vl sitemap", "https://www.vlaanderen.be/sitemap.xml", n=1500),
 lambda: (lambda s,f,b: "### vl vacatures page json bits\n" + "\n".join(sorted(set(re.findall(r'.{0,120}(?:cornerstone|overview|vacature[s]?Overview|jobOverview|search).{0,160}', b)))[:25]))(*req("https://www.vlaanderen.be/werken-voor-vlaanderen/vacatures")),
]
with cf.ThreadPoolExecutor(8) as ex:
    for r in ex.map(lambda f: f(), tasks): print(r, "\n")
