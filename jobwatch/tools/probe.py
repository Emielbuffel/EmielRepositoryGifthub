"""Probe 6 (temporary): Flemish government job records."""
import json, urllib.request
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
def post(body):
    r = urllib.request.Request("https://www.vlaanderen.be/api/overview-search", data=json.dumps(body).encode(),
                               headers={"User-Agent": UA, "Content-Type": "application/json", "Accept": "application/json"})
    with urllib.request.urlopen(r, timeout=30) as resp:
        return json.loads(resp.read())
for off in (0, 1):
    d = post({"page": {"offset": off, "limit": 100}, "filter": {"contentType": {"IN": ["Job"]}}, "resolverContext": {"language": "nl"}})
    print("offset", off, {k: d.get(k) for k in ("totalItems", "offset", "limit", "isLastPage", "firstItemOfPage", "lastItemOfPage")}, "items", len(d.get("items", [])))
    if off == 0:
        for it in d["items"][:2]:
            print(json.dumps(it, ensure_ascii=False)[:3500])
            print()
        print("TITLES:", [ (i.get("displayTitle"), i.get("link")) for i in d["items"][:15]])
        fit = [i.get("displayTitle") for i in d["items"] if "flanders" in json.dumps(i).lower() or "buitenland" in json.dumps(i).lower()]
        print("FIT/buitenland on page 1:", fit[:10])
