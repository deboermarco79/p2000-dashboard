#!/usr/bin/env python3
"""Kleine server voor het politie-dashboard (capcode 0127850).

Een browser mag de RSS-feed niet rechtstreeks lezen (CORS). Deze server haalt de
feed zelf op en geeft hem door aan de pagina, zodat er geen proxies nodig zijn.

Gebruik (op een pc, laptop, NAS of Raspberry Pi in hetzelfde netwerk als de tv):

    python3 server.py

Open daarna op de tv: http://<ip-adres-van-die-computer>:8000

Poort wijzigen kan met de omgevingsvariabele PORT (standaard 8000).
"""

import os
import socket
import threading
import time
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

FEED_URL = "https://www.alarmeringdroid.nl/rss/7738690e"
PORT = int(os.environ.get("PORT", "8000"))
CACHE_SECONDEN = 20
MAP = os.path.dirname(os.path.abspath(__file__))

_cache = {"tijd": 0.0, "data": None, "type": "application/rss+xml"}
_slot = threading.Lock()


def haal_feed():
    """Feed ophalen, met een korte cache zodat meerdere schermen de bron niet overbelasten."""
    with _slot:
        if _cache["data"] is not None and time.time() - _cache["tijd"] < CACHE_SECONDEN:
            return _cache["data"], _cache["type"]
        verzoek = urllib.request.Request(FEED_URL, headers={
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
            print(f"Feed ophalen mislukt, oude versie gebruikt: {fout}")
        return _cache["data"], _cache["type"]


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=MAP, **kwargs)

    def do_GET(self):
        if self.path.split("?")[0] == "/feed":
            try:
                data, soort = haal_feed()
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
        super().do_GET()

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
    print(f"Politie-dashboard draait. Open op de tv: http://{lokaal_ip()}:{PORT}")
    print(f"Feed: {FEED_URL}  (stoppen met Ctrl+C)")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
