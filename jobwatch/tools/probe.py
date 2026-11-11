"""Probe 2: find the data endpoints behind JS job pages (temporary)."""
import re, json, urllib.request, concurrent.futures as cf
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
def req(url, data=None, ctype="application/json"):
    h = {"User-Agent": UA, "Accept-Language": "nl,en", "Accept": "*/*"}
    if data is not None: h["Content-Type"] = ctype
    try:
        with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=h), timeout=30) as r:
            return r.status, r.geturl(), r.headers.get("Content-Type",""), r.read(4_000_000).decode("utf-8","replace")
    except urllib.error.HTTPError as e:
        return e.code, url, "", e.read(1500).decode("utf-8","replace")
    except Exception as e:
        return -1, url, "", repr(e)
def show(label, url, data=None, n=1500):
    s, f, ct, b = req(url, data)
    return f"### {label} {url}\nstatus={s} final={f} type={ct} len={len(b)}\n{b[:n]}"
def scripts_and_apis(url):
    s, f, ct, b = req(url)
    out = [f"### PAGE {url} status={s} len={len(b)}"]
    srcs = re.findall(r'<script[^>]+src="([^"]+)"', b)
    out.append("scripts: " + " | ".join(srcs[:25]))
    out.append("inline api: " + " | ".join(sorted(set(re.findall(r'["\'](/?(?:api|_next|wp-json|jsonapi|graphql)[^"\']{0,120})["\']', b)))[:20]))
    # fetch app scripts and grep endpoints
    found = set()
    for src in srcs[:25]:
        if src.startswith("//"): src = "https:" + src
        elif src.startswith("/"): src = re.match(r"https?://[^/]+", f).group(0) + src
        if not src.startswith("http"): continue
        s2, _, _, js = req(src)
        for m in re.findall(r'["\'`](https?://[a-z0-9.-]+[^"\'`\s]{0,100}|/(?:api|services|rest|jsonapi)[^"\'`\s]{1,100})["\'`]', js):
            if any(k in m.lower() for k in ("api", "vacat", "job", "search", "csod", "career")):
                found.add(m)
    out.append("endpoints in js:\n  " + "\n  ".join(sorted(found)[:60]))
    for m in re.finditer(r"(vacature|vacancy|job)", b[:0]): pass
    return "\n".join(out)
tasks = [
 lambda: scripts_and_apis("https://werkenvoor.be/nl/vacatures"),
 lambda: scripts_and_apis("https://www.vlaanderen.be/werken-voor-vlaanderen/vacatures"),
 lambda: show("FIT corporate", "https://corporate.flandersinvestmentandtrade.com/nl/jobs", n=600),
 lambda: show("FIT corporate en", "https://corporate.flandersinvestmentandtrade.com/en/jobs", n=600),
 lambda: show("FIT vacatures", "https://corporate.flandersinvestmentandtrade.com/nl/vacatures", n=600),
 lambda: (lambda s,f,ct,b: f"### diplomatie vacatures status={s} len={len(b)}\n" + "\n".join(sorted(set(re.sub(r'\s+',' ',x)[:160] for x in re.findall(r'<a [^>]*href="[^"]*"[^>]*>[^<]{8,140}</a>', b) if re.search(r'(?i)vacat|attach|selectie|job|functie|medewerker|deskundige', x))))[:40])(*req("https://diplomatie.belgium.be/nl/werken-voor-fod-buitenlandse-zaken/vacatures")),
 lambda: (lambda s,f,ct,b: f"### enabel search page structure status={s}\n" + (b[b.find('jobTitle-link')-600:b.find('jobTitle-link')+1500] if 'jobTitle-link' in b else b[20000:23000]) + "\nPAGINATION: " + " | ".join(sorted(set(re.findall(r'startrow=\d+', b)))))(*req("https://jobs.enabel.be/search/?q=&sortColumn=referencedate&sortDirection=desc&locale=en_US")),
 lambda: show("vdab vlaamse overheid", "https://www.vdab.be/vindeenjob/vacatures?trefwoord=vlaamse%20overheid", n=400),
]
with cf.ThreadPoolExecutor(8) as ex:
    for r in ex.map(lambda f: f(), tasks): print(r, "\n")
