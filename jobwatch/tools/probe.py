"""Probe 8 (temporary): WEF, Gavi, IUCN job systems."""
import re, json, urllib.request, concurrent.futures as cf
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
def req(url, data=None):
    h = {"User-Agent": UA, "Accept": "*/*", "Accept-Language": "en"}
    if data is not None: h["Content-Type"] = "application/json"; h["Accept"] = "application/json"
    try:
        with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=h), timeout=30) as r:
            return r.status, r.geturl(), r.read(3_000_000).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, url, e.read(500).decode("utf-8", "replace")
    except Exception as e:
        return -1, url, repr(e)
ATS = re.compile(r"https?://[a-z0-9.-]*(?:myworkdayjobs|myworkdaysite|oraclecloud|taleo|successfactors|smartrecruiters|greenhouse|lever\.co|csod|icims|recruitee|teamtailor|bamboohr|personio|workable|jobs\.|careers\.|pinpointhq|ashbyhq|jobvite|softgarden|umantis|refline|abacus|onlyfy|join\.com|dvinci|rexx)[^\"'\s<>)]*", re.I)
def page(u):
    s, f, b = req(u)
    t = re.search(r"<title>(.*?)</title>", b, re.S)
    ats = sorted(set(m.group(0)[:150] for m in ATS.finditer(b)))[:15]
    jl = sorted(set(re.findall(r'href="([^"]*(?:job|vacanc|career|position)[^"]*)"', b, re.I)))[:15]
    return f"### {u}\nstatus={s} final={f} len={len(b)} title={(t.group(1).strip()[:80] if t else '?')}\nATS: " + " | ".join(ats) + "\nLINKS: " + " | ".join(jl)
WD = json.dumps({"appliedFacets": {}, "limit": 2, "offset": 0, "searchText": ""}).encode()
def wd(u):
    s, f, b = req(u, WD); return f"### WD {u}\nstatus={s} {b[:300]}"
tasks = [lambda u=u: page(u) for u in [
  "https://www.weforum.org/careers", "https://www.weforum.org/about/careers/", "https://careers.weforum.org/",
  "https://www.gavi.org/our-alliance/work-us", "https://www.gavi.org/about-us/work-us", "https://www.gavi.org/careers",
  "https://iucn.org/careers", "https://iucn.org/about-iucn/careers", "https://www.iucn.org/about-iucn/careers", "https://careers.iucn.org/",
  "https://cepi.net/careers"]] + [lambda u=u: wd(u) for u in [
  "https://wef.wd3.myworkdayjobs.com/wday/cxs/wef/WEF/jobs", "https://weforum.wd3.myworkdayjobs.com/wday/cxs/weforum/External/jobs",
  "https://gavi.wd3.myworkdayjobs.com/wday/cxs/gavi/External/jobs", "https://gavi.wd103.myworkdayjobs.com/wday/cxs/gavi/External/jobs"]]
with cf.ThreadPoolExecutor(8) as ex:
    for r in ex.map(lambda f: f(), tasks): print(r, "\n")
