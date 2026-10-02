# Politie-data via Home Assistant naar Vercel

`api.politie.nl` blokkeert de servers van Vercel (HTTP 403 "Access Denied"). Een thuisverbinding wordt
meestal niet geblokkeerd. Home Assistant haalt daarom elke 10 minuten de politie-data op en stuurt die
naar Vercel (`api/push.js`); `nieuws.html` toont wat daar is opgeslagen.

## 1. Opslag koppelen in Vercel (eenmalig, gratis)
1. Vercel → je project → **Storage** (of Marketplace) → **Upstash Redis** → aanmaken en koppelen aan het project.
2. Vercel zet zelf de variabelen `KV_REST_API_URL` en `KV_REST_API_TOKEN`.

## 2. Geheime token
Vercel → Settings → Environment Variables → `PUSH_TOKEN` = een lange willekeurige tekst (bijv. 40 tekens).
Daarna opnieuw deployen. (Optioneel: `POLITIE_API_KEY` voor gezocht/vermist, en `POLITIE_EENHEID`, standaard `04`.)

## 3. Home Assistant
`configuration.yaml` (pas de domeinnaam aan naar jouw Vercel-project):
```yaml
shell_command:
  politie_nieuws_naar_vercel: >-
    sh -c 'for o in 0 25 50 75; do
    curl -sf -H "Accept: application/json" "https://api.politie.nl/v4/nieuws?language=nl&maxnumberofitems=25&offset=$o"
    | curl -sf -X POST -H "Content-Type: application/json" -H "x-push-token: JOUW_PUSH_TOKEN"
    --data-binary @- "https://narrowcasting-roan.vercel.app/api/push?soort=nieuws&offset=$o"; done'
  politie_gezocht_naar_vercel: >-
    sh -c 'for s in gezocht vermist; do
    curl -sf -H "Accept: application/json" -H "x-api-key: JOUW_POLITIE_SLEUTEL" "https://api.politie.nl/v5/$s?language=nl&maxnumberofitems=25"
    | curl -sf -X POST -H "Content-Type: application/json" -H "x-push-token: JOUW_PUSH_TOKEN"
    --data-binary @- "https://narrowcasting-roan.vercel.app/api/push?soort=$s&offset=0"; done'

automation:
  - alias: Politie-data naar Vercel
    trigger:
      - platform: time_pattern
        minutes: "/10"
    action:
      - service: shell_command.politie_nieuws_naar_vercel
      - service: shell_command.politie_gezocht_naar_vercel
```
Vervang `JOUW_PUSH_TOKEN` (de `PUSH_TOKEN` uit Vercel) en `JOUW_POLITIE_SLEUTEL` (alleen voor gezocht/vermist).
Controleer daarna in HA onder Ontwikkelaarstools → Acties of `shell_command.politie_nieuws_naar_vercel` zonder fout draait.

Test los vanuit een terminal met:
`curl -s -X POST -H "x-push-token: JOUW_TOKEN" -d '[]' "https://<project>.vercel.app/api/push?soort=nieuws&offset=0"`
(antwoord `{"bewaard":0}` betekent dat token en opslag werken).

## Alternatief zonder Home Assistant: GitHub Action
`.github/workflows/politie-naar-vercel.yml` doet hetzelfde elke 15 minuten vanaf een GitHub-runner.
Zet in GitHub (Settings > Secrets and variables > Actions) de secrets `VERCEL_URL`, `PUSH_TOKEN` en optioneel
`POLITIE_API_KEY`, en start de workflow één keer handmatig (Actions > Run workflow). Staat er in de log
"politie-api gaf HTTP 403", dan blokkeert de politie ook de GitHub-IP's en blijft Home Assistant de route.

## Alternatief: Cloudflare Worker als doorgeefluik
1. Cloudflare-account (gratis) → Workers & Pages → Create → Worker → plak `cloudflare/politie-worker.js` → Deploy.
2. Test in de browser: `https://<jouw-worker>.workers.dev/v4/nieuws?language=nl&maxnumberofitems=2` (moet JSON geven, geen "Access Denied").
3. Zet in Vercel `POLITIE_PROXY_URL` = die workers.dev-url (zonder slash) en deploy opnieuw.
Staat er bij stap 2 "Access Denied", dan blokkeert de politie ook Cloudflare.
