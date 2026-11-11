"""Probe 9 (temporary): Gavi vacancies, IUCN HRMS, WEF Workday."""
import re, json, urllib.request, concurrent.futures as cf
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
def req(url, data=None):
    h = {"User-Agent": UA, "Accept": "*/*", "Accept-Language": "en"}
    if data is not None: h["Content-Type"] = "application/json"; h["Accept"] = "application/json"
    try:
        with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=h), timeout=40) as r:
            return r.status, r.geturl(), r.read(3_000_000).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, url, e.read(500).decode("utf-8", "replace")
    except Exception as e:
        return -1, url, repr(e)
def around(u, pat, before=300, after=1800, n=2):
    s, f, b = req(u)
    ms = list(re.finditer(pat, b))
    out = [f"### {u} status={s} final={f} len={len(b)} matches={len(ms)}"]
    for m in ms[:n]: out.append(b[max(0, m.start()-before): m.start()+after])
    if not ms: out.append(b[:800])
    return "\n".join(out)
tasks = [
 lambda: around("https://www.gavi.org/about-us/work-us/vacancies", r"(?i)(vacanc[a-z]*/|closing|deadline|<h3|views-row)"),
 lambda: around("https://iucn.org/involved/jobs", r"(?i)(hrms\.iucn\.org/vacancy|closing date|views-row)"),
 lambda: around("https://hrms.iucn.org/", r"(?i)(vacancy/\d+|closing)"),
 lambda: around("https://hrms.iucn.org/vacancies", r"(?i)(vacancy/\d+|closing)"),
 lambda: (lambda s,f,b: f"### WEF WD status={s}\n{b[:900]}")(*req("https://weforum.wd3.myworkdayjobs.com/wday/cxs/weforum/Forum_Careers/jobs", json.dumps({"appliedFacets": {}, "limit": 3, "offset": 0, "searchText": ""}).encode())),
]
with cf.ThreadPoolExecutor(6) as ex:
    for r in ex.map(lambda f: f(), tasks): print(r, "\n")
