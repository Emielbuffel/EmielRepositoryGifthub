#!/usr/bin/env python3
"""Collect market data for Premium Coach and write it into the app.

- Share and index prices, moving averages and 52-week highs: Yahoo Finance chart API.
- Real option prices (bid / ask / last per strike and expiry) for Euronext stocks: Beursgenoten.nl.
- Market direction: distribution days on the S&P 500 and Nasdaq (IBD definition).

Usage:  python3 premium-coach/fetch_data.py
It writes premium-coach/data.json, puts the data into app.html and rebuilds index.html.
Only the Python standard library is used.
"""
import datetime as dt
import html
import json
import pathlib
import re
import time
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
UA = "PremiumCoach/1.0 (personal learning app)"

# ticker in the app -> (Yahoo symbol, Beursgenoten path or None)
UNDERLYINGS = {
    "AEX": ("^AEX", None), "AEX-L": ("^AEX", None), "OESX": ("^STOXX50E", None),
    "SHELL": ("SHELL.AS", "euronext-aandelen-amsterdam/shell"),
    "UNA": ("UNA.AS", "euronext-aandelen-amsterdam/unilever"),
    "AD": ("AD.AS", "euronext-aandelen-amsterdam/ahold-delhaize"),
    "KPN": ("KPN.AS", "euronext-aandelen-amsterdam/kpn"),
    "HEIA": ("HEIA.AS", "euronext-aandelen-amsterdam/heineken"),
    "NN": ("NN.AS", "euronext-aandelen-amsterdam/nn"),
    "INGA": ("INGA.AS", "euronext-aandelen-amsterdam/ing-groep"),
    "ABN": ("ABN.AS", "euronext-aandelen-amsterdam/abn-amro"),
    "PHIA": ("PHIA.AS", "euronext-aandelen-amsterdam/philips"),
    "WKL": ("WKL.AS", "euronext-aandelen-amsterdam/wolters-kluwer"),
    "KBC": ("KBC.BR", "euronext-brussel/kbc"),
    "UCB": ("UCB.BR", "euronext-brussel/ucb"),
    "ASML": ("ASML.AS", "euronext-aandelen-amsterdam/asml"),
    "ASM": ("ASM.AS", "euronext-aandelen-amsterdam/asmi"),
    "BESI": ("BESI.AS", "euronext-aandelen-amsterdam/be-semiconductor"),
    "ADYEN": ("ADYEN.AS", "euronext-aandelen-amsterdam/adyen"),
    "SAP": ("SAP.DE", None), "SIE": ("SIE.DE", None), "ALV": ("ALV.DE", None),
    "MUV2": ("MUV2.DE", None), "DTE": ("DTE.DE", None), "IFX": ("IFX.DE", None),
    "RHM": ("RHM.DE", None),
}
MARKET = {"SPX": "^GSPC", "NASDAQ": "^IXIC", "VIX": "^VIX", "SX5E": "^STOXX50E", "AEXI": "^AEX"}


def get(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read().decode("utf-8", "ignore")
        except Exception as e:  # noqa: BLE001
            err = e
            time.sleep(5 * (i + 1))
    raise err


def yahoo(symbol):
    """Daily closes and volumes for about 14 months, plus the latest quote."""
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.request.quote(symbol)}?range=14mo&interval=1d"
    j = json.loads(get(url))["chart"]["result"][0]
    m, q = j["meta"], j["indicators"]["quote"][0]
    rows = [(t, c, v) for t, c, v in zip(j["timestamp"], q["close"], q["volume"]) if c is not None]
    closes = [c for _, c, _ in rows]
    price = m.get("regularMarketPrice") or closes[-1]
    ma = lambda n: sum(closes[-n:]) / n if len(closes) >= n else None  # noqa: E731
    hi = max(closes[-252:] + [m.get("fiftyTwoWeekHigh") or 0])
    return {
        "symbol": symbol, "price": round(price, 4), "currency": m.get("currency"),
        "time": m.get("regularMarketTime"), "prevClose": closes[-2] if len(closes) > 1 else None,
        "ma50": ma(50) and round(ma(50), 4), "ma200": ma(200) and round(ma(200), 4),
        "high52": round(hi, 4),
        "chg3m": round(price / closes[-63] - 1, 4) if len(closes) > 63 else None,
        "chg12m": round(price / closes[-252] - 1, 4) if len(closes) > 252 else None,
        "_rows": rows,
    }


def distribution_days(rows):
    """IBD-style count: index down >= 0.2% on higher volume than the day before, within the last
    25 sessions, dropped once the index has risen 5% above that day's close."""
    rows = rows[-26:]
    out = []
    for i in range(1, len(rows)):
        (_, c0, v0), (t1, c1, v1) = rows[i - 1], rows[i]
        if v0 and v1 and c1 <= c0 * 0.998 and v1 > v0:
            later = [c for _, c, _ in rows[i + 1:]]
            if not later or max(later) < c1 * 1.05:
                out.append(dt.datetime.fromtimestamp(t1, dt.timezone.utc).strftime("%Y-%m-%d"))
    return out


def num(s):
    s = re.sub(r"<[^>]+>", "", s).strip().replace(".", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def beursgenoten(path):
    """All expiry series from a Beursgenoten options page, monthly (American) contracts only."""
    page = get(f"https://www.beursgenoten.nl/koersen/{path}/opties")
    parts = re.split(r'id="serie(\d{8})"', page)
    series, counts = [], {}
    for k in range(1, len(parts), 2):
        date, body = parts[k], parts[k + 1]
        rows = []
        for tr in re.findall(r"<tr>(.*?)</tr>", body, flags=re.S):
            td = re.findall(r"<td[^>]*>(.*?)</td>", tr, flags=re.S)
            if len(td) != 9:
                continue
            strong = lambda x: (re.findall(r"<strong>(.*?)</strong>", x, flags=re.S) or [x])[0]  # noqa: E731
            code = html.unescape(re.sub(r"<[^>]+>", "", strong(td[0]))).strip()
            strike = num(td[4])
            if not code or strike is None or code.lower() == "call":
                continue
            # columns: call code | last | bid | ask | strike | put ask | put bid | put last | put code
            rows.append({"code": code, "k": strike, "cl": num(strong(td[1])), "cb": num(strong(td[2])),
                         "ca": num(strong(td[3])), "pa": num(strong(td[5])), "pb": num(strong(td[6])),
                         "pl": num(strong(td[7]))})
            counts[code] = counts.get(code, 0) + 1
        series.append({"exp": f"{date[:4]}-{date[4:6]}-{date[6:]}", "rows": rows})
    if not series:
        return None
    # the standard monthly contract is the code that appears in the most expiry series
    in_series = {c: sum(any(r["code"] == c for r in s["rows"]) for s in series) for c in counts}
    monthly = max(in_series, key=lambda c: (in_series[c], counts[c]))
    out = []
    for s in series:
        rows = sorted([{k: v for k, v in r.items() if k != "code"} for r in s["rows"] if r["code"] == monthly],
                      key=lambda r: r["k"])
        if rows:
            out.append({"exp": s["exp"], "rows": rows})
    m = re.search(r'id="header-stock-time" unix="(\d+)"', page)
    return {"code": monthly, "source": f"https://www.beursgenoten.nl/koersen/{path}/opties",
            "time": int(m.group(1)) if m else None, "series": out}


def main():
    data = {"generated": int(time.time()), "underlyings": {}, "market": {}, "errors": []}
    cache = {}
    for t, (ysym, bg) in UNDERLYINGS.items():
        entry = {}
        try:
            if ysym not in cache:
                time.sleep(0.8)
            y = cache.get(ysym) or yahoo(ysym)
            cache[ysym] = y
            entry.update({k: v for k, v in y.items() if not k.startswith("_")})
        except Exception as e:  # noqa: BLE001
            data["errors"].append(f"{t} price: {e}")
        if bg:
            try:
                o = beursgenoten(bg)
                if o:
                    p = entry.get("price")
                    o["series"] = [{"exp": se["exp"], "rows": [r for r in se["rows"] if not p or 0.6 * p <= r["k"] <= 1.3 * p]}
                                   for se in o["series"][:6]]
                    entry["options"] = o
            except Exception as e:  # noqa: BLE001
                data["errors"].append(f"{t} options: {e}")
            time.sleep(1.5)
        data["underlyings"][t] = entry
    for k, sym in MARKET.items():
        try:
            y = cache.get(sym) or yahoo(sym)
            item = {kk: v for kk, v in y.items() if not kk.startswith("_")}
            if k in ("SPX", "NASDAQ"):
                item["distDays"] = distribution_days(y["_rows"])
                c = [c for _, c, _ in y["_rows"]]
                item["drawdown"] = round(c[-1] / max(c[-252:]) - 1, 4)
            data["market"][k] = item
        except Exception as e:  # noqa: BLE001
            data["errors"].append(f"{k}: {e}")
    (HERE / "data.json").write_text(json.dumps(data, separators=(",", ":")))
    block = "/*LIVE-DATA*/const LIVE=" + json.dumps(data, separators=(",", ":")) + ";/*END-LIVE-DATA*/"
    app = HERE / "app.html"
    s = re.sub(r"/\*LIVE-DATA\*/.*?/\*END-LIVE-DATA\*/", lambda _: block, app.read_text(), flags=re.S)
    app.write_text(s)
    # index.html = the same page with a full HTML wrapper, to open offline on the Mac
    head, body = s.split("</style>", 1)
    (HERE / "index.html").write_text(
        '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
        "<style>[hidden]{display:none!important}</style>" + head + "</style></head><body>" + body + "</body></html>")
    n_opt = sum(1 for u in data["underlyings"].values() if u.get("options"))
    print(f"prices: {sum(1 for u in data['underlyings'].values() if u.get('price'))}, "
          f"option chains: {n_opt}, errors: {len(data['errors'])}")
    for e in data["errors"]:
        print("  -", e)


if __name__ == "__main__":
    main()
