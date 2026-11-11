"""Probe 5 (temporary): how vlaanderen.be calls /api/overview-search."""
import re, urllib.request
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
def get(u):
    with urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": UA}), timeout=30) as r:
        return r.read().decode("utf-8", "replace")
page = get("https://www.vlaanderen.be/werken-voor-vlaanderen/vacatures")
srcs = re.findall(r'src="(/_nuxt/[^"]+\.js)"', page)
seen = set(srcs)
queue = list(srcs)
hits = 0
while queue and len(seen) < 120:
    s = queue.pop(0)
    try:
        js = get("https://www.vlaanderen.be" + s)
    except Exception as e:
        continue
    for m in re.findall(r'["\'](\.?/?(?:_nuxt/)?[A-Za-z0-9_-]+\.js)["\']', js):
        p = "/_nuxt/" + m.split("/")[-1]
        if p not in seen:
            seen.add(p); queue.append(p)
    for m in re.finditer(r"overview-search", js):
        hits += 1
        print(f"=== {s} @ {m.start()}\n{js[max(0, m.start()-1500): m.start()+1500]}\n")
        if hits >= 4: break
    if hits >= 4: break
print("scanned", len(seen), "files, hits", hits)
