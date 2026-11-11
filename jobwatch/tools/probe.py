"""Probe 7 (temporary): deadlines and apply links on job detail pages."""
import re, json, urllib.request, concurrent.futures as cf
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
def get(u):
    try:
        with urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": UA, "Accept": "*/*"}), timeout=30) as r:
            return r.status, r.read(3_000_000).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, ""
    except Exception as e:
        return -1, repr(e)
KW = re.compile(r"(?i)(deadline|closing date|closes on|apply by|application deadline|date limite|fecha l[ií]mite|cierre|end date|expires?)")
def look(u):
    s, b = get(u)
    txt = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", re.sub(r"(?s)<script.*?</script>|<style.*?</style>", " ", b)))
    hits = [txt[max(0, m.start()-60): m.start()+120] for m in KW.finditer(txt)][:5]
    links = []
    for m in re.finditer(r'<a [^>]*href="(https?://[^"]+)"[^>]*>(.*?)</a>', b, re.S):
        t = re.sub(r"<[^>]+>", "", m.group(2)).strip()
        host = re.match(r"https?://([^/]+)", m.group(1)).group(1)
        if not any(x in host for x in ("unjobs.org", "impactpool.org", "facebook", "twitter", "linkedin", "google", "x.com", "instagram", "youtube", "doubleclick", "apple.com", "unjobs.media", "assets.")):
            links.append(f"{m.group(1)[:150]} :: {t[:50]}")
    return f"### {u} status={s} len={len(b)}\nDEADLINE-ISH: " + " || ".join(hits) + "\nEXTERNAL LINKS: " + " | ".join(list(dict.fromkeys(links))[:10])
urls = ["https://www.impactpool.org/jobs/1243483", "https://www.impactpool.org/jobs/1247141", "https://unjobs.org/vacancies/1769001776116",
        "https://unjobs.org/vacancies/1794283274830",
        "https://estm.fa.em2.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=ById;Id=%2237889%22,siteNumber=CX_1",
        "https://wfp.wd3.myworkdayjobs.com/wday/cxs/wfp/job_openings/job/Rome-Italy/Financial-Business-System-Analyst--P3-_JR128308"]
with cf.ThreadPoolExecutor(6) as ex:
    for r in ex.map(look, urls): print(r, "\n")
s, b = get(urls[4])
try:
    d = json.loads(b)["items"][0]; print("ORACLE KEYS:", {k: (str(v)[:80] if v else v) for k, v in d.items() if not isinstance(v, list) and any(x in k.lower() for x in ("date", "end", "url", "apply"))})
except Exception as e: print("oracle", e, b[:300])
