#!/usr/bin/env python3
"""Job watch: collect new vacancies, score them against the profile, notify, build the dashboard.

Run:  python3 jobwatch/jobwatch.py            (normal run, sends notifications)
      python3 jobwatch/jobwatch.py --no-notify (collect and build only)
Settings live in jobwatch/profile.json. Seen jobs live in jobwatch/data/jobs.json.
"""
import concurrent.futures as cf
import json
import os
import re
import smtplib
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from email.mime.text import MIMEText
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import sources  # noqa: E402
import reminders  # noqa: E402
from lang import guess as guess_lang  # noqa: E402

DATA = HERE / "data" / "jobs.json"
DASH_TEMPLATE = HERE / "dashboard_template.html"
DASH_OUT = HERE / "dashboard.html"
NOW = datetime.now(timezone.utc)
TODAY = NOW.date()
KEEP_DAYS_WITHOUT_DEADLINE = 35


# ------------------------------------------------------------------ classification
def word_re(word, plural=False):
    """Match a whole word or phrase ('gis' does not match 'logistics' or 'gisi'; 'roma' does not match 'romania').
    plural=True also accepts a plural ending; a trailing * accepts any longer word."""
    w = word.lower().strip()
    if w.endswith("*"):
        return re.compile(r"(?<![a-z0-9])" + re.escape(w[:-1]))
    return re.compile(r"(?<![a-z0-9])" + re.escape(w) + (r"(?:s|es)?" if plural else "") + r"(?![a-z0-9])")


class Profile:
    def __init__(self, raw):
        self.raw = raw
        self.locations = {name: [word_re(a) for a in aliases] for name, aliases in raw["locations"].items()}
        self.notify_locations = set(raw.get("notify_locations", []))
        self.keywords = [(k.rstrip("*"), word_re(k, plural=True), w) for k, w in raw["keywords"].items()]
        self.interests = {g: [word_re(w, plural=True) for w in words] for g, words in raw.get("interests", {}).items()}
        aa = raw.get("always_alert") or {}
        self.always_label = aa.get("label", "")
        self.always_pats = [word_re(w, plural=True) for w in aa.get("words", [])]
        self.un_bonus = raw.get("un_bonus", 0)
        orgs = raw.get("un_organisations", [])
        self.un_re = re.compile(r"(?<![A-Za-z])(" + "|".join(re.escape(o) for o in orgs) + r")(?![A-Za-z])") if orgs else None
        self.exclude = [word_re(x, plural=True) for x in raw.get("exclude_title", [])]
        self.min_score = raw.get("min_score_to_notify", 4)
        self.top_score = raw.get("top_score", 20)
        self.priority_locations = set(raw.get("priority_locations", []))
        self.top_anywhere = bool(raw.get("top_score_anywhere", False))

    def tier(self, j):
        """3 = top match, 2 = priority place, 1 = normal match, 0 = no alert."""
        if j["excluded"]:
            return 0
        if self.always_label and self.always_label in (j.get("interests") or []):
            return 3 if j["score"] >= self.top_score else 2
        in_places = bool(set(j["regions"]) & self.notify_locations)
        if j["score"] >= self.top_score and (in_places or self.top_anywhere):
            return 3
        if not in_places or j["score"] < self.min_score:
            return 0
        return 2 if set(j["regions"]) & self.priority_locations else 1

    def regions(self, j):
        """Places from the profile found in the job's location (or, failing that, its title)."""
        loc = j["location"].lower()
        found = [n for n, pats in self.locations.items() if any(p.search(loc) for p in pats)]
        if not found:
            title = j["title"].lower()
            found = [n for n, pats in self.locations.items() if any(p.search(title) for p in pats)]
        return found

    def score(self, j):
        title = j["title"].lower()
        rest = f"{j['category']} {j['summary']} {j['jtype']}".lower()
        s, hits = 0, []
        for k, pat, w in self.keywords:
            if pat.search(title):
                s += 2 * w
                hits.append(k.strip())
            elif pat.search(rest):
                s += w
                hits.append(k.strip())
        if s and self.is_un(j):
            s += self.un_bonus
        return s, hits

    def is_un(self, j):
        return bool(self.un_re and (j["source"] in UN_SOURCES or self.un_re.search(j["org"] or "")))

    def interests_of(self, j):
        text = f"{j['title']} {j['category']} {j['summary']}".lower()
        found = [g for g, pats in self.interests.items() if any(p.search(text) for p in pats)]
        if self.is_un(j):
            found.append("UN")
        if self.always_label and self.always_alert(j):
            found.append(self.always_label)
        return found

    def always_alert(self, j):
        text = f"{j['org']} {j['title']} {j['summary']}".lower()
        return any(p.search(text) for p in self.always_pats)

    def excluded(self, j):
        t = j["title"].lower()
        return any(p.search(t) for p in self.exclude)


UN_SOURCES = {"UN Careers", "FAO", "WHO", "UNDP", "UNFPA", "UNICEF", "WFP", "UNHCR"}

LEVEL_RE = re.compile(r"(?<![A-Za-z])(P|D|G|GS|NO|FS|SB|LICA|NPSA|IPSA|SSA|NOA|NOB|NOC|NOD)[- ]?(\d{1,2}|[A-D])?(?![A-Za-z0-9])")


def level_of(j):
    for text in (j["level"], j["title"], j["jtype"]):
        for m in LEVEL_RE.finditer(text or ""):
            code, num = m.group(1), m.group(2)
            if code in ("NOA", "NOB", "NOC", "NOD"):
                return "NO-" + code[2]
            if num:
                return f"{code}-{num}"
            if code in ("NPSA", "IPSA", "LICA", "SSA"):
                return code
    return (j["level"] or "")[:20]


def type_of(j, level):
    t = f"{j['title']} {j['level']} {j['jtype']} {level}".lower()
    if re.search(r"\bintern(ship)?s?\b|\binternship", t):
        return "Internship"
    if re.search(r"\bjpo\b|junior professional officer", t):
        return "JPO"
    if re.search(r"\bunv\b|volunteer", t):
        return "UN Volunteer"
    if re.search(r"consult|individual contractor|\bic\b|\bcon\b|\blica|\bssa\b|\bipsa\b|\bnpsa\b|contractor|\bpsa\b|retainer|roster", t):
        return "Consultancy / contract"
    if re.search(r"\bp-\d|\bd-\d|\bfs-\d|international professional", t):
        return "International staff"
    if re.search(r"\bno-[a-d0-9]|national officer|national professional", t):
        return "National officer"
    if re.search(r"\bg-\d|\bgs-\d|general service|\bsb-\d", t):
        return "Support staff"
    if re.search(r"fixed[- ]term|temporary appointment|staff", t):
        return "Staff (grade not stated)"
    return "Not stated"


NOISE_RE = re.compile(r"\b(home[- ]?based|remote|open to internal and external applicants|internal and external|"
                      r"fixed[- ]term|temporary|national consultant|international consultant)\b")


def fingerprint(j, regions, profile):
    """Same job on two websites -> same key: title without places, grades and brackets, plus the main place."""
    t = re.sub(r"\[.*?\]|\(.*?\)|#\d+", " ", j["title"].lower())
    t = LEVEL_RE.sub(" ", t.upper()).lower()
    for pats in profile.locations.values():
        for p in pats:
            t = p.sub(" ", t)
    t = NOISE_RE.sub(" ", t)
    t = re.sub(r"[^a-z0-9]+", " ", t).strip()
    return f"{t[:80]}|{(regions or ['?'])[0]}"


# ------------------------------------------------------------------ state
def load_state():
    if DATA.exists():
        return json.loads(DATA.read_text())
    return {"jobs": {}, "runs": []}


def save_state(state):
    DATA.parent.mkdir(parents=True, exist_ok=True)
    jobs = dict(sorted(state["jobs"].items(), key=lambda kv: (kv[1]["first_seen"], kv[0]), reverse=True))
    lines = ",\n".join(f"  {json.dumps(k)}: {json.dumps(v, ensure_ascii=False, sort_keys=True)}" for k, v in jobs.items())
    meta = {k: v for k, v in state.items() if k != "jobs"}
    DATA.write_text("{\n" + ",\n".join(f"  {json.dumps(k)}: {json.dumps(v, ensure_ascii=False)}" for k, v in meta.items())
                    + ',\n  "jobs": {\n' + lines + "\n  }\n}\n")


def expired(j):
    if j.get("deadline"):
        try:
            return datetime.fromisoformat(j["deadline"]).date() < TODAY - timedelta(days=1)
        except ValueError:
            pass
    first = datetime.fromisoformat(j["first_seen"]).date()
    return first < TODAY - timedelta(days=KEEP_DAYS_WITHOUT_DEADLINE)


# ------------------------------------------------------------------ notifications
def ntfy(topic, title, message, click=None, tags="briefcase", priority=3, raw=False):
    if not topic:
        return
    body = {"topic": topic, "title": title[:250], "message": message[:3900], "tags": tags.split(","), "priority": priority}
    if click:
        body["click"] = click
        body["actions"] = [{"action": "view", "label": "Open vacancy", "url": click}]
    req = urllib.request.Request("https://ntfy.sh/", data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    try:
        urllib.request.urlopen(req, timeout=20).read()
    except Exception as e:
        print(f"!! ntfy failed: {e}")


def email(subject, text):
    user, pw, to = os.environ.get("SMTP_USER"), os.environ.get("SMTP_PASSWORD"), os.environ.get("ALERT_EMAIL_TO")
    if not (user and pw and to):
        return
    msg = MIMEText(text, "plain", "utf-8")
    msg["Subject"], msg["From"], msg["To"] = subject, user, to
    try:
        with smtplib.SMTP_SSL(os.environ.get("SMTP_HOST", "smtp.gmail.com"), 465, timeout=30) as s:
            s.login(user, pw)
            s.sendmail(user, [to], msg.as_string())
    except Exception as e:
        print(f"!! email failed: {e}")


def describe(j):
    bits = [j["org"] or j["source"], ", ".join(j["regions"]) or j["location"], j["level"] or j["type"]]
    line = " · ".join(b for b in bits if b)
    if j.get("deadline"):
        line += f"\nDeadline: {j['deadline']}"
    if j.get("hits"):
        line += f"\nMatches: {', '.join(j['hits'][:6])}"
    return line


def notify(new_matches, topic, first_run, total, dash_url):
    if not new_matches:
        return
    new_matches.sort(key=lambda j: -j["score"])
    if first_run:
        top = "\n".join(f"• {j['title']} ({', '.join(j['regions'])})" for j in new_matches[:10])
        ntfy(topic, f"Job watch is on: {len(new_matches)} matching vacancies open now",
             f"Tracking {total} vacancies. Best matches:\n{top}\n\nFrom now on you get one alert per new match.", click=dash_url, tags="tada")
        return
    loud = [j for j in new_matches if j["tier"] >= 2]
    normal = [j for j in new_matches if j["tier"] < 2]
    for j in loud[:15]:
        top = j["tier"] == 3
        ntfy(topic, f"{'TOP MATCH ' + str(j['score']) if top else 'Match ' + str(j['score'])} · {', '.join(j['regions']) or j['location']}: {j['title']}",
             describe(j), click=j["url"], tags="rotating_light,star" if top else "star", priority=5 if top else 4)
        time.sleep(1)
    if len(loud) > 15:
        ntfy(topic, f"{len(loud) - 15} more priority matches", "Open the dashboard to see them all.", click=dash_url, priority=4)
    if len(normal) <= 5:
        for j in normal:
            ntfy(topic, f"{', '.join(j['regions'])}: {j['title']}", describe(j), click=j["url"], tags="briefcase", priority=3)
            time.sleep(1)
    else:
        lst = "\n".join(f"• {j['title']} — {j['org'] or j['source']} ({', '.join(j['regions'])})" for j in normal[:12])
        ntfy(topic, f"{len(normal)} new matching vacancies", lst, click=dash_url or normal[0]["url"], tags="briefcase", priority=3)
    text = "\n\n".join(f"{j['title']}\n{describe(j)}\n{j['url']}" for j in new_matches)
    email(f"Job watch: {len(new_matches)} new matching vacancies", text)


# ------------------------------------------------------------------ dashboard
def build_dashboard(state, profile):
    if not DASH_TEMPLATE.exists():
        return
    jobs = list(state["jobs"].values())
    payload = {
        "generated": NOW.isoformat(timespec="minutes"),
        "notify_locations": profile.raw.get("notify_locations", []),
        "min_score": profile.min_score,
        "top_score": profile.top_score,
        "priority_locations": sorted(profile.priority_locations),
        "interests": list(profile.interests) + ["UN"] + ([profile.always_label] if profile.always_label else []),
        "sources": state.get("last_sources", {}),
        "jobs": jobs,
    }
    data = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    page = DASH_TEMPLATE.read_text().replace("/*__JOBWATCH_DATA__*/null", data)
    # a full document, so the file also opens correctly straight from disk
    DASH_OUT.write_text('<!doctype html><html lang="en"><head><meta charset="utf-8">'
                        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
                        '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}'
                        'body{margin:0}[hidden]{display:none!important}</style></head><body>\n' + page + "\n</body></html>\n")


# ------------------------------------------------------------------ main
def main():
    do_notify = "--no-notify" not in sys.argv
    profile = Profile(json.loads((HERE / "profile.json").read_text()))
    topic = os.environ.get("NTFY_TOPIC") or profile.raw.get("ntfy_topic")
    dash_url = os.environ.get("DASHBOARD_URL") or profile.raw.get("dashboard_url") or None
    state = load_state()
    first_run = not state["jobs"]
    rekeyed = {}
    for rec in state["jobs"].values():
        rec["regions"] = profile.regions(rec)
        k = fingerprint(rec, rec["regions"], profile)
        if k in rekeyed:
            rekeyed[k]["sources"] = sorted(set(rekeyed[k].get("sources", [])) | set(rec.get("sources", [])))
            rekeyed[k]["first_seen"] = min(rekeyed[k]["first_seen"], rec["first_seen"])
        else:
            rekeyed[k] = rec
    state["jobs"] = rekeyed
    known_urls = {r["url"] for r in state["jobs"].values()}

    srcs = sources.all_sources(profile.raw, os.environ.get("RELIEFWEB_APPNAME", ""))
    raw, report = [], {}
    t0 = time.time()
    with cf.ThreadPoolExecutor(max_workers=8) as ex:
        futs = {ex.submit(fn): name for name, fn in srcs.items()}
        for f in cf.as_completed(futs):
            name = futs[f]
            try:
                got = f.result()
                raw.extend(got)
                report[name] = {"ok": True, "count": len(got)}
                print(f"✓ {name}: {len(got)} jobs")
            except Exception as e:
                report[name] = {"ok": False, "count": 0, "error": str(e)[:200]}
                print(f"✗ {name}: {e}")
    if not raw:
        print("No jobs fetched at all; keeping the old data.")
        return 1
    print(f"Fetched {len(raw)} jobs in {time.time() - t0:.0f}s")

    now_s = NOW.isoformat(timespec="minutes")
    new_matches, seen_now = [], set()
    for j in raw:
        if not j["title"] or not j["url"]:
            continue
        regions = profile.regions(j)
        fp = fingerprint(j, regions, profile)
        if fp in seen_now:
            continue
        seen_now.add(fp)
        old = state["jobs"].get(fp)
        if not old and j["url"] in known_urls:
            continue  # seen before under another key
        lvl = level_of(j)
        score, hits = profile.score(j)
        rec = {**j, "regions": regions, "level": lvl, "type": type_of(j, lvl), "score": score, "hits": hits, "interests": profile.interests_of(j), "lang": guess_lang(f"{j['title']} {j['summary']}"),
               "excluded": profile.excluded(j)}
        rec.pop("sid", None)
        if old:
            rec["first_seen"] = old["first_seen"]
            rec["sources"] = sorted(set(old.get("sources", [])) | {j["source"]})
            # keep the richer record (e.g. one with a deadline)
            for k in ("deadline", "posted", "level", "org", "location", "category"):
                if not rec.get(k) and old.get(k):
                    rec[k] = old[k]
            state["jobs"][fp] = rec
            continue
        rec["first_seen"] = now_s
        rec["sources"] = [j["source"]]
        state["jobs"][fp] = rec
        rec["tier"] = profile.tier(rec)
        rec["alert"] = rec["tier"] > 0
        if rec["alert"]:
            new_matches.append(rec)

    before = len(state["jobs"])
    state["jobs"] = {k: v for k, v in state["jobs"].items() if not expired(v)}
    state["last_sources"] = report
    state["updated"] = now_s
    state["runs"] = (state.get("runs") or [])[-47:] + [{"at": now_s, "fetched": len(raw), "new_matches": len(new_matches)}]
    print(f"New matching vacancies: {len(new_matches)}; removed expired: {before - len(state['jobs'])}; tracked: {len(state['jobs'])}")
    for j in sorted(new_matches, key=lambda j: -j["score"])[:40]:
        print(f"  [{j['score']:>3}] {', '.join(j['regions'])} | {j['title']} | {j['org'] or j['source']}")

    if do_notify:
        notify(new_matches, topic, first_run, len(state["jobs"]), dash_url)
    try:
        rem = reminders.update(state, profile, NOW, ntfy, topic, dry=not do_notify)
        print(f"Deadline reminders active: {len(rem)}")
        for r in sorted(rem.values(), key=lambda r: r["deadline"]):
            print(f"  {r['deadline']} remind {r['remind'][:16]} | {r['name'][:90]}")
    except Exception as e:
        print(f"!! reminders failed: {e}")
    save_state(state)
    build_dashboard(state, profile)

    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a") as fh:
            fh.write(f"### Job watch {now_s}\n\n| Source | Status | Jobs |\n|---|---|---|\n")
            for n, r in sorted(report.items()):
                fh.write(f"| {n} | {'ok' if r['ok'] else 'failed: ' + r.get('error', '')[:80]} | {r['count']} |\n")
            fh.write(f"\n**{len(new_matches)} new matching vacancies** · {len(state['jobs'])} tracked\n\n")
            for j in new_matches[:50]:
                fh.write(f"- [{j['title']}]({j['url']}) — {j['org'] or j['source']} · {', '.join(j['regions'])} · score {j['score']}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
