#!/usr/bin/env python3
"""Kleine server voor het persalarm-dashboard.

Een browser mag de RSS-feed niet rechtstreeks lezen (CORS). Deze server haalt de
feed zelf op en geeft hem door aan de pagina, zodat er geen proxies nodig zijn.

Gebruik (op een pc, laptop, NAS of Raspberry Pi in hetzelfde netwerk als de tv):

    python3 server.py

Open daarna op de tv: http://<ip-adres-van-die-computer>:8000
Narrowcasting (wisselende pagina's, o.a. voor Chromecast): http://<ip>:8000/narrowcast.html

Poort wijzigen kan met de omgevingsvariabele PORT (standaard 8000).
"""

import json
import os
import re
import socket
import threading
import time
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs
from itertools import zip_longest
import xml.etree.ElementTree as ET
from html import unescape

# Zelfde volgorde als FEEDS in index.html (/feed?bron=0, /feed?bron=1, enz.)
FEEDS = [
    "https://www.alarmeringdroid.nl/rss/7738690e",
    "https://www.alarmeringdroid.nl/rss/5ef7e920",
    "https://www.alarmeringdroid.nl/rss/132e8974",
    "https://www.alarmeringdroid.nl/rss/6fa78810",
    "https://www.alarmeringdroid.nl/rss/a067947f",
    "https://112hier.nl/feed.json?capcodes=0127850",
    "https://112hier.nl/feed.json?capcodes=0104972",
    "https://112hier.nl/feed.json?capcodes=0127185",
    "https://112hier.nl/feed.json?capcodes=0205625",
]

# ---- Narrowcasting (narrowcast.html) ----
# Plaats voor het weer (standaard Zaandam)
WEER_PLAATS = "Zaandam"
WEER_LAT, WEER_LON = 52.44, 4.83
# Nieuwsbronnen: (naam, rss-url)
NIEUWS_FEEDS = [
    ("Politie Noord-Holland", "https://rss.politie.nl/rss/ob/provincies/noord-holland.xml"),
    ("Politie Noord-Holland", "https://rss.politie.nl/rss/ab/provincies/noord-holland.xml"),
]
# Sociale media: (naam, rss-url). Gratis en zonder sleutel werkt bijv. Mastodon:
#   ("Gemeente", "https://mastodon.nl/@gebruikersnaam.rss")
# Instagram/Facebook/X bieden geen gratis feed; gebruik daarvoor een RSS-brug (bijv. rss.app)
# en zet de resulterende RSS-url hier neer. Leeg = de pagina wordt overgeslagen.
SOCIAL_FEEDS = []
DATA_CACHE_SECONDEN = 300
PORT = int(os.environ.get("PORT", "8000"))
CACHE_SECONDEN = 20
MAP = os.path.dirname(os.path.abspath(__file__))

_caches = [{"tijd": 0.0, "data": None, "type": "application/rss+xml"} for _ in FEEDS]
_sloten = [threading.Lock() for _ in FEEDS]  # per feed, zodat een trage feed de andere niet ophoudt


def haal_feed(bron):
    """Feed ophalen, met een korte cache zodat meerdere schermen de bron niet overbelasten."""
    _cache = _caches[bron]
    with _sloten[bron]:
        if _cache["data"] is not None and time.time() - _cache["tijd"] < CACHE_SECONDEN:
            return _cache["data"], _cache["type"]
        verzoek = urllib.request.Request(FEEDS[bron], headers={
            "User-Agent": "Mozilla/5.0 (P2000 dashboard)",
            "Accept": "application/rss+xml, application/xml, text/xml, */*",
        })
        try:
            with urllib.request.urlopen(verzoek, timeout=15) as antwoord:
                _cache["data"] = antwoord.read()
                _cache["type"] = antwoord.headers.get("Content-Type", "application/rss+xml")
                _cache["tijd"] = time.time()
        except Exception as fout:
            if _cache["data"] is None:
                raise
            # Bron tijdelijk onbereikbaar: laatste goede versie teruggeven
            print(f"{FEEDS[bron]} ophalen mislukt, oude versie gebruikt: {fout}")
        return _cache["data"], _cache["type"]


_data_cache = {}
_data_slot = threading.Lock()


def haal_url(url):
    """Algemene ophaler met cache; bij een storing blijft de laatste goede versie in gebruik."""
    with _data_slot:
        c = _data_cache.get(url)
        if c and time.time() - c[0] < DATA_CACHE_SECONDEN:
            return c[1]
        try:
            verzoek = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (narrowcasting)"})
            with urllib.request.urlopen(verzoek, timeout=15) as r:
                data = r.read()
            _data_cache[url] = (time.time(), data)
            return data
        except Exception as fout:
            if c:
                print(f"{url} ophalen mislukt, oude versie gebruikt: {fout}")
                return c[1]
            raise


def lees_rss(naam, url, max_items=8):
    wortel = ET.fromstring(haal_url(url))
    uit = []
    for item in wortel.iter("item"):
        def tekst(tag):
            e = item.find(tag)
            return (e.text or "").strip() if e is not None else ""
        omschrijving = re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]+>", " ", tekst("description")))).strip()
        plaatje = ""
        for e in item.iter():
            if e.tag.endswith("}content") or e.tag.endswith("}thumbnail") or e.tag == "enclosure":
                u = e.get("url", "")
                if u and (e.get("type", "image").startswith("image") or e.get("medium") == "image"):
                    plaatje = u
                    break
        if not plaatje:
            html = tekst("description") + " " + " ".join((e.text or "") for e in item.iter() if e.tag.endswith("}encoded"))
            m = re.search(r"<img[^>]+src=[\"']([^\"']+)", html)
            plaatje = m.group(1) if m else ""
        uit.append({"bron": naam, "titel": tekst("title"), "tekst": omschrijving[:400],
                    "datum": tekst("pubDate"), "plaatje": plaatje})
        if len(uit) >= max_items:
            break
    return uit


def feeds_json(feeds):
    per_bron = []
    for naam, url in feeds:
        try:
            per_bron.append(lees_rss(naam, url))
        except Exception as fout:
            print(f"{url} lezen mislukt: {fout}")
    # Om en om per bron, zodat elke bron zichtbaar is op de pagina
    items = [i for groep in zip_longest(*per_bron) for i in groep if i]
    return json.dumps(items).encode()


def weer_json():
    url = ("https://api.open-meteo.com/v1/forecast?latitude=%s&longitude=%s&timezone=Europe%%2FAmsterdam"
           "&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,precipitation"
           "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset"
           "&wind_speed_unit=bft&forecast_days=5" % (WEER_LAT, WEER_LON))
    d = json.loads(haal_url(url))
    d["plaats"] = WEER_PLAATS
    return json.dumps(d).encode()


def nieuws_kolom(i):
    """Eén nieuwsfeed, alleen de vijf meest recente items (voor nieuws.html)."""
    naam, url = NIEUWS_FEEDS[i]
    return json.dumps(lees_rss(naam, url, 5)).encode()


DATA_ROUTES = {
    "/data/nieuws0": lambda: nieuws_kolom(0),
    "/data/nieuws1": lambda: nieuws_kolom(1),
    "/data/weer": weer_json,
    "/data/nieuws": lambda: feeds_json(NIEUWS_FEEDS),
    "/data/social": lambda: feeds_json(SOCIAL_FEEDS),
}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=MAP, **kwargs)

    def do_GET(self):
        pad, _, query = self.path.partition("?")
        if pad == "/feed":
            try:
                bron = int(parse_qs(query).get("bron", ["0"])[0])
                if not 0 <= bron < len(FEEDS):
                    raise ValueError
            except ValueError:
                self.send_error(404, "Onbekende feed")
                return
            try:
                data, soort = haal_feed(bron)
            except Exception as fout:
                self.send_error(502, f"Feed niet bereikbaar: {fout}")
                return
            self.send_response(200)
            self.send_header("Content-Type", soort)
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if pad in DATA_ROUTES:
            try:
                data = DATA_ROUTES[pad]()
            except Exception as fout:
                self.send_error(502, f"Bron niet bereikbaar: {fout}")
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if pad in ("/narrowcast.html", "/nieuws.html"):
            super().do_GET()
            return
        # Alleen de pagina zelf en de dienst-logo's; de rest van de map (zoals .git) blijft privé
        if pad in ("/", "/index.html"):
            self.path = "/index.html"
            super().do_GET()
            return
        if pad.startswith("/icons/") and "/" not in pad[len("/icons/"):]:
            super().do_GET()
            return
        self.send_error(404, "Niet gevonden")

    def log_message(self, fmt, *args):
        pass  # geen log per verzoek


def lokaal_ip():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("192.0.2.1", 80))  # er wordt niets verstuurd
            return s.getsockname()[0]
    except OSError:
        return "localhost"


if __name__ == "__main__":
    print(f"Persalarm-dashboard draait. Open op de tv: http://{lokaal_ip()}:{PORT}")
    for url in FEEDS:
        print(f"Feed: {url}")
    print(f"Narrowcasting: http://{lokaal_ip()}:{PORT}/narrowcast.html")
    print("Stoppen met Ctrl+C")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
