# Instagram-narrowcasting: Politie Eenheid Noord-Holland

Standalone Google Apps Script Web App voor een 1920x1080-tv (kijkafstand 3-5 m). Toont het actuele aantal volgers en het laatste bericht van `@politie_eenheid_noordholland`. Draait onbemand en toont nooit een foutmelding.

## Bestanden

| Bestand | Doel |
|---|---|
| `appsscript.json` | Manifest: tijdzone, V8, scopes, Web App-instellingen |
| `Code.gs` | Backend: sync, opslag, alerts, token-verversing, triggers, `getDashboardData()` |
| `Index.html` | Frontend in één bestand (geen externe fonts/CDN's) |
| `tests/logic.test.js` | Node-tests zonder dependencies: `node tests/logic.test.js` |

## Architectuur

1. Een time-driven trigger (`syncTick`, elke 30 min) haalt de data op. De client roept **nooit** de Meta API aan; `getDashboardData()` leest alleen uit cache/opslag.
2. Opslag: `CacheService` (TTL 6 uur, waarden < 100 KB; afbeeldingen in stukken van 90.000 tekens) en `PropertiesService` (`LAST_GOOD`, permanente bunker). Caption maximaal 600 tekens (9 KB-limiet per property).
3. De afbeelding wordt server-side gedownload en in een eigen Drive-map bewaard (`Narrowcasting Instagram Dashboard`); het bestand-ID staat in Properties (`IMAGE_FILE_ID`). De client krijgt een base64 data-URI. Het bestand wordt alleen vervangen bij een nieuw post-id. Met `IMAGE_STORE=hotlink` wordt de CDN-URL doorgegeven en is Drive niet nodig.
4. `getDashboardData(knownVersion)` geeft `{unchanged:true}` als de client de actuele versie (`post-id@fetchedAt`) al heeft.

Bij een mislukte sync wordt bestaande data **nooit** overschreven; alleen `LAST_ERROR` en `CONSECUTIVE_FAILURES` veranderen.

## Script Properties

| Property | Standaard | Betekenis |
|---|---|---|
| `META_ACCESS_TOKEN` | `PLAK_HIER_JE_TOKEN` | Instagram-token. Zolang dit een placeholder is, wordt er niet gefetcht |
| `IG_USER_ID` | `me` | `me` werkt alleen op `graph.instagram.com`. Op `graph.facebook.com` is het numerieke Instagram-account-ID nodig |
| `API_HOST` | `https://graph.instagram.com` | Alternatief: `https://graph.facebook.com` |
| `GRAPH_VERSION` | `v25.0` | |
| `ALERT_EMAIL` | `PLAK_HIER_JE_EMAILADRES` | Ontvanger van alerts (zonder geldig adres: geen mail) |
| `USE_MOCK` | `true` | `true` = voorbeelddata zonder netwerk |
| `IMAGE_STORE` | `drive` | `drive` of `hotlink` |
| `DEBUG_NOW_ISO` | (leeg) | Overschrijft "nu" uitsluitend voor tests, bijv. `2026-10-10T05:30:00Z` |

Intern bijgehouden (niet zelf wijzigen): `LAST_GOOD`, `IMAGE_FILE_ID`, `DRIVE_FOLDER_ID`, `LAST_ATTEMPT_MS`, `LAST_SUCCESS_AT`, `CONSECUTIVE_FAILURES`, `LAST_ERROR`, `LAST_ALERT_DATE`, `TOKEN_REFRESHED_AT`, `LAST_REFRESH_ERROR`.

## Installatie

1. Maak een Apps Script-project en kopieer `Code.gs`, `Index.html` en `appsscript.json` (Projectinstellingen: "appsscript.json tonen in editor").
2. Voer `setupScriptProperties()` eenmalig uit. Bestaande waarden worden nooit overschreven.
3. **Test eerst zonder token**: laat `USE_MOCK=true` staan en deploy (zie hieronder). Het scherm toont voorbeelddata.
4. Token genereren (Instagram Login, zonder Facebook-pagina):
   1. Meta for Developers: maak een app en voeg het product *Instagram* toe (API-setup met Instagram-login).
   2. Het account moet een professioneel account zijn (Business of Creator) en als Instagram-tester/rol aan de app gekoppeld zijn.
   3. Genereer in de API-setup een long-lived token met de permissie `instagram_business_basic`.
   4. Plak het in `META_ACCESS_TOKEN` (Projectinstellingen, Script-eigenschappen). Zet het token **nooit** in code, README of een repository.
5. Zet `USE_MOCK=false` en `ALERT_EMAIL` op een echt adres. Voer `forceSync()` uit en daarna `logStatus()`. Controleer `lastError`.
6. Voer `installTriggers()` uit (idempotent: verwijdert eerst eigen oude triggers). Er komen twee triggers: `syncTick` elke 30 min en `refreshTokenIfNeeded` dagelijks (Apps Script start die ergens tussen 10:00 en 11:00).
7. Deploy als Web App (Implementeren > Nieuwe implementatie > Web-app; uitvoeren als: ik; toegang: iedereen). Open de URL op de tv in een browser in kiosk-/volledig-schermmodus.

### Testen

* **Mock**: `USE_MOCK=true`. Voorbeelddata met hashtags en URL in de caption om de opschoning te zien.
* **Tijd/venster**: `DEBUG_NOW_ISO=2026-10-10T20:30:00Z` (22:30 Amsterdam) laat `syncTick` niets doen; `...T05:30:00Z` (07:30) wel. Ook de mock-tijdstempel en de klok van het scherm volgen deze waarde (de server stuurt zijn "nu" mee). Verwijder de property na het testen.
* **Relatieve tijd**: ververs `DEBUG_NOW_ISO` stapsgewijs en kijk hoe "Laatste bericht" verandert.

## Gedrag

* **Venster**: `syncTick` doet alleen iets tussen 07:00 (incl.) en 22:00 (excl.) Amsterdamse tijd en doet buiten het venster geen externe calls. `refreshTokenIfNeeded` volgt hetzelfde venster. `forceSync()` negeert venster en interval.
* **Dubbel vuren**: `LockService.tryLock` plus een minimale afstand van 25 minuten sinds de vorige poging.
* **Retry**: maximaal 1 retry na 2 s, alleen bij netwerkfout of 5xx.
* **Foutherkenning**: code 190 = token ongeldig; 4/17/32/613 = rate limit; 100 (o.a. 100/33 "Unsupported get request") = configuratiefout (verkeerd ID, host of rechten), zonder retry.
* **Alerts** (`MailApp`, maximaal 1 per dag): na 3 opeenvolgende fouten, bij code 190, bij een configuratiefout van Meta (code 100), en als het token ouder is dan 50 dagen zonder geslaagde verversing.
* **Token verversen**: alleen bij `graph.instagram.com`, via `GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token`. Wordt pas echt uitgevoerd bij een token ouder dan 40 dagen (en dus ouder dan de vereiste 24 uur). Bij `graph.facebook.com` is de functie een nette no-op: daar loopt het token via de Facebook-app/pagina (long-lived of system-user token) en is er geen `ig_refresh_token`-flow. Houd dan zelf de geldigheid in de gaten.
* **Nieuw bericht zonder bruikbare afbeelding** (bijv. auteursrechtelijk materiaal, download mislukt): het vorige bericht blijft staan en alleen het volgersaantal wordt bijgewerkt, omdat tekst en beeld anders niet meer bij elkaar horen. Bij hetzelfde post-id (bijv. aangepaste caption) wordt alleen de tekst bijgewerkt.

## Problemen oplossen (Graph API-fouten)

| Foutmelding | Betekenis en oplossing |
|---|---|
| `code 100, error_subcode 33`, "Unsupported get request" | Het object bestaat niet, is niet leesbaar met dit token, of het endpoint past niet bij het ID-type. Controleer: (a) `IG_USER_ID=me` geldt alleen voor `graph.instagram.com`; op `graph.facebook.com` is het numerieke Instagram-account-ID nodig; (b) is het ID van het *Instagram*-account (niet van een Facebook-pagina of -gebruiker); (c) heeft het token de juiste permissie; (d) hoort het token bij de gekozen host. De app meldt dit zonder retry en mailt maximaal 1x per dag. |
| `code 190`, "Invalid OAuth 2.0 Access Token" | Het token is ongeldig, verlopen of van het verkeerde type voor deze host (een Facebook-token werkt niet op `graph.instagram.com` en andersom). Genereer een nieuw token en vervang `META_ACCESS_TOKEN`. De app blijft tot dan de laatste data tonen. |

Welke host welke fout gaf, is uit de foutmelding alleen niet te halen. Test dezelfde URL in de Graph API Explorer met dezelfde host en hetzelfde token.

**Verifieer de veldsyntax per host.** De aanvraag is `GET {API_HOST}/{GRAPH_VERSION}/{IG_USER_ID}?fields=followers_count,username,media.limit(1){id,caption,media_type,media_url,thumbnail_url,permalink,timestamp}`. Of deze geneste `media`-syntax precies zo werkt op `graph.instagram.com` én `graph.facebook.com` is lokaal niet geverifieerd. Controleer dit in de Graph API Explorer (en pas de velden alleen aan op basis van wat de Explorer accepteert) voordat je livegaat.

## OAuth-scopes (`appsscript.json`)

| Scope | Waarom |
|---|---|
| `script.external_request` | `UrlFetchApp`: Meta-API en het downloaden van de afbeelding |
| `script.scriptapp` | `ScriptApp`: triggers installeren en opruimen |
| `script.send_mail` | `MailApp`: alerts aan `ALERT_EMAIL` |
| `drive` | `DriveApp`: afbeelding opslaan in een eigen map. Alleen nodig bij `IMAGE_STORE=drive`; bij `hotlink` kun je deze scope verwijderen. `DriveApp` vraagt de volledige Drive-scope, ook al gebruikt de code alleen de eigen map |

Cache, Properties, Lock en HtmlService vragen geen aparte scope. Web App: `executeAs: USER_DEPLOYING`, `access: ANYONE_ANONYMOUS`, tijdzone `Europe/Amsterdam`, runtime V8.

## Contrastratio's (WCAG, doel >= 7:1)

Berekend in `tests/logic.test.js` uit de CSS-variabelen van `Index.html`:

| Tekstkleur | `--bg` #0b111e | `--bg-2` #0d172a | `--panel` #111d36 |
|---|---|---|---|
| `--text` #ffffff | 18,87:1 | 17,90:1 | 16,76:1 |
| `--text-muted` #c3cee6 | 11,94:1 | 11,33:1 | 10,61:1 |
| `--accent-blue` #6db3ff (label "volgers") | 8,57:1 | 8,13:1 | 7,62:1 |

De rode accentstreep (#ff5a6a) is decoratie en bevat geen tekst. Tekst op de geblurde afbeelding komt niet voor; de caption staat onder de afbeelding op de achtergrond.

Typografie: volgers 220 px, caption 40 px, kleinste tekst 36 px (test bewaakt minimaal 32 px).

## Aannames

* Weergavenaam "Politie Eenheid Noord-Holland" staat vast in de code; de handle komt uit het API-veld `username` (terugval: `politie_eenheid_noordholland`). Er is geen `name`-veld opgevraagd, om geen velden buiten de opdracht te verzinnen.
* Het logo-slot is een lege 120x120-ruimte linksboven. Er is bewust geen politielogo of embleem nagemaakt.
* Het linkerpaneel is minimaal 640 px breed (ca. 35%) en groeit mee met het volgersaantal bij 220 px; "12.345" geeft ca. 40%. Bij >= 7 cijfers (miljoenen) past het niet meer binnen de maximale breedte van 900 px.
* "Achtergrondige hashtag-blokken" is gelezen als: hashtags aan het eind van de caption, regels met alleen hashtags en regels met alleen punten. Hashtags midden in een zin blijven staan. De client kapt na opschoning af op 420 tekens (op een woordgrens) voor de 5-regelige line-clamp.
* Bij >= 24 uur maar toch dezelfde kalenderdag (de 25-uursdag in oktober) toont het scherm "N uur geleden".
* Tijdstempels van Instagram (`+0000` zonder dubbele punt) worden vóór het parsen genormaliseerd. Een tv-klok die afwijkt wordt gecorrigeerd met het servertijdstip uit het poll-antwoord.
* Tijdens de allereerste lege staat pollt de client elke 60 s (alleen cache lezen), zodat de eerste data snel verschijnt. Daarna elke 5 min (`POLL_INTERVAL_MS`). Na fouten: backoff 15 s, 30 s, ... tot maximaal 5 min.
* De dagelijkse stille herlaadbeurt (04:00-04:59 Amsterdam, alleen als de pagina >= 30 min draait, om een herlaadlus te voorkomen) staat aan via `DAILY_RELOAD_ENABLED` in `Index.html`.
* Video-berichten tonen de thumbnail (`thumbnail_url`), geen afspeelbare video.
* Bij een token zonder `TOKEN_REFRESHED_AT` start de teller op het moment van de eerste dagelijkse run (de werkelijke leeftijd is dan onbekend).

## Voor deploy controleren

1. **Werkt "Anyone" als toegang binnen ons Workspace-beleid?** Een Web App met `ANYONE_ANONYMOUS` kan door beheerders geblokkeerd zijn. Zo niet: toegang "iedereen met een Google-account" en de tv ingelogd laten, of een ander kanaal kiezen.
2. **Verschijnt er een Google-banner op de tv?** Apps Script-Web Apps kunnen een waarschuwingsbalk tonen (bijv. "Deze applicatie is gemaakt door een andere Google-gebruiker"). Controleer op de echte tv-browser of dit voorkomt, en zo ja of het binnen de iframe-weergave of de browser-kioskmodus te verbergen is.
3. **Is Drive-gebruik toegestaan?** Zo niet: `IMAGE_STORE=hotlink` en de `drive`-scope uit `appsscript.json` halen. In hotlink-modus is de CDN-link kortlevend; de client laadt de afbeelding alleen bij een nieuw bericht en houdt het geladen beeld daarna vast.

## Handmatige checklist (niet lokaal te verifiëren)

Lokaal getest: alle pure logica en enkele ontwerpcontroles (zie hieronder). **Niet** getest, controleer dit zelf:

- [ ] Echte Meta-call: veldsyntax, `media_url`/`thumbnail_url`, rechten en rate-limits voor jouw account en host
- [ ] `refresh_access_token` werkt met jouw token (>= 24 uur oud)
- [ ] `UrlFetchApp`, `DriveApp`, `CacheService`-chunking, `LockService` en `MailApp` in Apps Script zelf (alleen met stubs lokaal bekeken)
- [ ] `Utilities.formatDate` levert in Apps Script dezelfde Amsterdam-klok als de Intl-variant in de tests
- [ ] `installTriggers()` en het werkelijke triggergedrag (tijdstip, geen dubbele runs)
- [ ] Deploy als Web App, toegang "Anyone", Google-banner, laadtijd op de tv
- [ ] `location.reload()` van de dagelijkse reload binnen de Apps Script-iframe werkt op de tv (anders `DAILY_RELOAD_ENABLED=false`)
- [ ] Weergave op de echte tv (overscan, kleuren, line-clamp) en gedrag na stroom-/netwerkuitval
- [ ] Workspace-beleid (externe aanvragen, Drive, mail, publieke Web Apps)

## Tests draaien

```
node tests/logic.test.js
```

Gedekt: venstergrenzen en DST-dagen (2026-03-29, 2026-10-25), `shouldSync`, caption inkorten (hashtags, URLs, lange woorden, emoji), alle relatieve-tijdgrenzen (59/60 s, 59/60 min, 23/24 u, kalenderdag rond middernacht, DST), foutclassificatie (190, 4/17/32/613, 100/33, 5xx), configvalidatie, poll-backoff, contrast en typografie. De client-logica wordt uit `Index.html` gehaald tussen `// <pure>` en `// </pure>`. De tests zijn ook gedraaid met `TZ=UTC`, `America/New_York`, `Pacific/Auckland` en `Asia/Kolkata`.
