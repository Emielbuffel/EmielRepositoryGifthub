"""Probe 4 (temporary)."""
import re, json, urllib.request, concurrent.futures as cf
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
def req(url, data=None):
    h = {"User-Agent": UA, "Accept-Language": "nl,en", "Accept": "application/json, text/html, */*"}
    if data is not None: h["Content-Type"] = "application/json"
    try:
        with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=h), timeout=30) as r:
            return r.status, r.read(6_000_000).decode("utf-8","replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read(600).decode("utf-8","replace")
    except Exception as e:
        return -1, repr(e)
def vl(body):
    s, b = req("https://www.vlaanderen.be/api/overview-search", json.dumps(body).encode())
    try:
        d = json.loads(b)
        its = d.get("items") or []
        return f"### VL {json.dumps(body)[:200]}\nstatus={s} total={d.get('totalItems')} first: " + " || ".join(f"{i.get('contentType')} {i.get('link')} {i.get('displayTitle','')[:50]}" for i in its[:3])
    except Exception:
        return f"### VL {json.dumps(body)[:200]}\nstatus={s} {b[:300]}"
bodies = [
 {"contentTypes": ["Job"]}, {"contentTypes": ["job"]}, {"contentTypes": ["Vacancy"]}, {"contentType": "Job"},
 {"filter": {"contentType": ["Job"]}}, {"filters": [{"field": "contentType", "operator": "IN", "values": ["Job"]}]},
 {"contentTypes": ["Job"], "limit": 5, "offset": 0},
]
def diplo():
    s, b = req("https://diplomatie.belgium.be/nl/werken-voor-fod-buitenlandse-zaken/vacatures")
    i = b.find("career2.successfactors")
    j = b.find("werkenvoor.be/nl/jobs/")
    return f"### diplo status={s}\n--- around SF link:\n{b[max(0,i-2500):i+400]}\n--- around werkenvoor link:\n{b[max(0,j-1500):j+300]}"
def vlpage():
    s, b = req("https://www.vlaanderen.be/werken-voor-vlaanderen/vacatures")
    m = re.search(r'contentTypes:\[(\w+)\]', b)
    out = [f"### vl page cr var: {m.group(0) if m else None}"]
    if m:
        var = m.group(1)
        mm = re.search(r'\bfunction\s*\(([^)]*)\)', b[b.find('window.__NUXT__'):b.find('window.__NUXT__')+5000])
        out.append("NUXT fn params: " + (mm.group(1)[:3000] if mm else "?"))
        tail = b[b.find('window.__NUXT__'):]
        out.append("NUXT args tail: " + tail[-3000:])
    return "\n".join(out)
with cf.ThreadPoolExecutor(8) as ex:
    for r in ex.map(lambda f: f(), [diplo, vlpage] + [ (lambda bb=b: vl(bb)) for b in bodies]): print(r, "\n")
