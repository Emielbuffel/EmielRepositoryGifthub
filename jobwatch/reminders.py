"""Deadline reminders: find deadlines for top matches, publish them for the Mac Reminders helper,
and send a phone alert the day before the deadline."""
import json
import re
import time
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import sources
from lang import guess as guess_lang

TZ = ZoneInfo("Europe/Brussels")
MONTHS = {m: i + 1 for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}
DATE_RX = (r"(\d{1,2})[ .\-/]([A-Za-z]{3,9})[ .\-/,]*(\d{4})"          # 17 November 2026, 15-Nov-2026
           r"|([A-Za-z]{3,9}) (\d{1,2}),? (\d{4})"                        # November 17, 2026
           r"|(\d{4})-(\d{2})-(\d{2})"                                    # 2026-11-17
           r"|(\d{1,2})[./](\d{1,2})[./](\d{4})")                         # 17/11/2026, 17.11.2026
LABEL_RX = re.compile(r"(?i)(application deadline|deadline for applications|closing date|posting end date|deadline|apply by|"
                      r"closes on|date limite|fecha l[ií]mite(?: de postulaci[oó]n)?)\s*[:\-]?\s*(?:" + DATE_RX + ")")


def _to_date(g):
    try:
        if g[0]:
            return date(int(g[2]), MONTHS[g[1][:3].lower()], int(g[0]))
        if g[3]:
            return date(int(g[5]), MONTHS[g[3][:3].lower()], int(g[4]))
        if g[6]:
            return date(int(g[6]), int(g[7]), int(g[8]))
        if g[9]:
            return date(int(g[11]), int(g[10]), int(g[9]))
    except (KeyError, ValueError):
        return None
    return None


def deadline_in_text(text, today):
    txt = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", text or ""))
    for m in LABEL_RX.finditer(txt):
        d = _to_date(m.groups()[1:])
        if d and today - timedelta(days=1) <= d <= today + timedelta(days=370):
            return d
    return None


def find_deadline(url, today):
    """Look the deadline up on the job page itself. Returns a date or None."""
    m = re.match(r"https://([^/]+)/hcmUI/CandidateExperience/[a-z]+/sites/([^/]+)/job/(\d+)", url)
    if m:  # Oracle (UNDP, UNFPA, Save the Children, NRC)
        api = (f"https://{m.group(1)}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?expand=all&onlyData=true"
               f"&finder=ById;Id=%22{m.group(3)}%22,siteNumber={m.group(2)}")
        item = (json.loads(sources.fetch(api)).get("items") or [{}])[0]
        end = item.get("ExternalPostedEndDate")
        if end:
            return datetime.fromisoformat(end).astimezone(TZ).date()
        return deadline_in_text(item.get("ExternalDescriptionStr", ""), today)
    m = re.match(r"https://(([^.]+)\.wd\d+\.myworkdayjobs\.com)/[a-zA-Z-]+/([^/]+)(/job/.+)", url)
    if m:  # Workday (WFP, UNHCR, World Vision, Global Fund)
        data = json.loads(sources.fetch(f"https://{m.group(1)}/wday/cxs/{m.group(2)}/{m.group(3)}{m.group(4)}"))
        info = data.get("jobPostingInfo") or {}
        if info.get("endDate"):
            return sources.parse_date(info["endDate"][:10])
        return deadline_in_text(info.get("jobDescription", ""), today)
    return deadline_in_text(sources.fetch(url), today)


def eligible(rec, profile):
    """Top match, in one of the alert places, not French, not excluded."""
    return (not rec.get("excluded") and rec.get("score", 0) >= profile.top_score
            and bool(set(rec.get("regions") or []) & profile.notify_locations)
            and rec.get("lang") != "fr")


def update(state, profile, now, ntfy, topic, dry=False):
    today = now.astimezone(TZ).date()
    rem = state.setdefault("reminders", {})
    looked = state.setdefault("deadline_lookups", {})
    # forget reminders whose deadline has passed
    for k in [k for k, r in rem.items() if r["deadline"] < today.isoformat()]:
        rem.pop(k)
    for k in [k for k, d in looked.items() if d < (today - timedelta(days=3)).isoformat()]:
        looked.pop(k)

    budget = time.time() + 120
    for fp, rec in state["jobs"].items():
        rec["lang"] = rec.get("lang") or guess_lang(f"{rec['title']} {rec.get('summary', '')}")
        if not eligible(rec, profile):
            continue
        if not rec.get("deadline") and fp not in looked and time.time() < budget:
            looked[fp] = today.isoformat()  # one look-up per job per 3 days
            try:
                d = find_deadline(rec["url"], today)
                if d:
                    rec["deadline"] = d.isoformat()
                    rec["deadline_found_on_page"] = True
            except Exception as e:
                print(f"   deadline look-up failed for {rec['url'][:80]}: {e}")
        if not rec.get("deadline") or rec["deadline"] < today.isoformat():
            continue
        dl = date.fromisoformat(rec["deadline"])
        remind = datetime.combine(dl - timedelta(days=1), datetime.min.time(), TZ).replace(hour=9)
        if remind < now.astimezone(TZ):  # deadline is today or tomorrow already: remind in 5 minutes
            remind = (now + timedelta(minutes=5)).astimezone(TZ).replace(second=0, microsecond=0)
        entry = rem.get(fp)
        if entry and entry["deadline"] == rec["deadline"]:
            continue
        rem[fp] = {
            "id": re.sub(r"[^a-z0-9]+", "-", fp.lower())[:90],
            "name": f"Apply: {rec['title'][:90]} ({', '.join(rec['regions'])})",
            "body": (f"{rec.get('org') or rec.get('source', '')}\n{rec.get('location', '')}\n"
                     f"Deadline: {rec['deadline']} · CV match {rec['score']}\nApply here: {rec['url']}"),
            "url": rec["url"], "deadline": rec["deadline"],
            "due": datetime.combine(dl, datetime.min.time(), TZ).replace(hour=12).isoformat(),
            "remind": remind.isoformat(), "created": now.isoformat(timespec="minutes"),
            "day_before_sent": entry.get("day_before_sent", False) if entry else False,
        }
        if not dry:
            ntfy(topic, f"Reminder set · deadline {dl.strftime('%d %b')}: {rec['title'][:80]}",
                 f"{rec.get('org') or rec.get('source', '')} · {', '.join(rec['regions'])}\n"
                 f"You get a reminder on {remind.strftime('%a %d %b, %H:%M')}.", click=rec["url"], tags="calendar", priority=3)

    # phone alert the day before (works even without the Mac helper)
    for r in rem.values():
        if not r["day_before_sent"] and datetime.fromisoformat(r["remind"]) <= now.astimezone(TZ):
            if not dry:
                ntfy(topic, f"Deadline tomorrow: {r['name'][7:]}", r["body"], click=r["url"], tags="alarm_clock", priority=5)
            r["day_before_sent"] = True

    # hand the active reminders to the Mac helper (several small messages, newest run wins)
    items = [{k: r[k] for k in ("id", "name", "body", "due", "remind")} for r in rem.values()]
    run = now.isoformat(timespec="seconds")
    chunks, cur = [], []
    for it in items:
        if cur and len(json.dumps(cur + [it], ensure_ascii=False)) > 3300:
            chunks.append(cur)
            cur = []
        cur.append(it)
    chunks.append(cur)
    if not dry:
        for i, ch in enumerate(chunks):
            ntfy(topic + "-reminders", "jobwatch reminders",
                 json.dumps({"kind": "jobwatch-reminders", "run": run, "part": i, "parts": len(chunks), "items": ch},
                            ensure_ascii=False), priority=1, raw=True)
    return rem
