# Persalarm-dashboard als Google Apps Script-webapp

Zelfde dashboard als de Vercel-versie (`../index.html`), maar dan draaiend op
Google Apps Script. De Vercel-site blijft ongewijzigd en blijft gewoon
bestaan — dit is een extra, onafhankelijke manier om het dashboard te
hosten (bv. als gratis alternatief of back-up).

Het belangrijkste verschil zit in hoe de feeds worden opgehaald:
- **Vercel** (`index.html` + `api/feed.js`): de browser probeert een reeks
  routes (eigen Vercel-proxy, rechtstreeks, publieke CORS-proxies, ...).
- **Apps Script** (deze map): `Code.gs` haalt alle feeds rechtstreeks op
  via `UrlFetchApp` (server-naar-server, dus geen CORS-probleem en geen
  proxies nodig). `Index.html` roept dat aan via `google.script.run`.

Opmerking: Apps Script's `HtmlService` serveert geen losse statische
bestanden (zoals `/icons/politie.png`), dus de ronde logo-badges uit de
Vercel-versie staan hier niet; in plaats daarvan toont elk label gewoon een
gekleurd stipje (politie blauw, brandweer rood) — functioneel identiek,
alleen zonder de logo's.

## Deployen

Er is geen API-toegang vanuit deze sessie om een Apps Script-project
automatisch aan te maken of te deployen (dat vereist de losse Apps
Script API, niet beschikbaar in deze omgeving). Dit is een handmatige
stap van een paar minuten:

### Optie A — kopiëren via script.google.com (geen installatie nodig)

1. Ga naar [script.google.com](https://script.google.com) en klik op
   **Nieuw project**.
2. Geef het project een naam, bv. "Persalarm".
3. Open `Code.gs` in dit project (standaard aanwezig) en plak de inhoud
   van [`Code.gs`](./Code.gs) hieruit erin.
4. Maak een nieuw HTML-bestand aan (linker menu → **+** → **HTML**),
   noem het exact `Index` (zonder `.html`, dat voegt Apps Script zelf toe),
   en plak de inhoud van [`Index.html`](./Index.html) erin.
5. Open **Projectinstellingen** (tandwiel-icoon) → **Toon
   "appsscript.json" manifestbestand in editor** aanzetten. Open daarna
   `appsscript.json` in de editor en vervang de inhoud door
   [`appsscript.json`](./appsscript.json) hieruit.
6. Klik rechtsboven op **Implementeren → Nieuwe implementatie**.
   - Type: **Webapp**.
   - Uitvoeren als: **Mij** (zodat jouw Apps Script-quotum voor
     `UrlFetchApp` gebruikt wordt, niet dat van de kijker).
   - Toegang: **Iedereen** (zodat de tv/telefoon zonder Google-login kan
     kijken).
7. Klik **Implementeren** en kopieer de **webapp-URL**. Dat is het
   adres dat je op de tv/Chromecast opent, net als de Vercel-URL nu.

### Optie B — met `clasp` (handig als je dit vaker wilt bijwerken)

```bash
npm install -g @google/clasp
clasp login
cd google-apps-script
clasp create --type webapp --title "Persalarm"
clasp push
clasp deploy
```

Daarna in de Apps Script-editor (`clasp open`) nog eenmalig **Implementeren
→ Nieuwe implementatie** doorlopen zoals bij Optie A, stap 6-7 (de
toegangsinstellingen staan niet in `clasp deploy` zelf).

### Updaten

Wijzig je later iets in `Code.gs` of `Index.html` in dit repo, dan moet je
dat ook kopiëren naar het Apps Script-project (optie A) of opnieuw pushen
(`clasp push && clasp deploy`, optie B) — dit gaat niet automatisch mee met
een `git push`, in tegenstelling tot de Vercel-site.
