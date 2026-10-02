# Politie-extensie (Chromebook / Chrome)

De politie-API staat geen verzoeken van onze website toe (CORS) en blokkeert Vercel. Deze extensie haalt de data
via jouw eigen verbinding op.

1. Download of kopieer de map `extensie/` naar de Chromebook (bijv. bij Downloads).
2. Chrome → `chrome://extensions` → zet **Ontwikkelaarsmodus** aan (rechtsboven).
3. **Uitgepakte extensie laden** → kies de map `extensie`.
4. Open `https://narrowcasting-roan.vercel.app/nieuws.html` en ververs met Ctrl+Shift+R.

Gebruik je een ander domein, pas dan `matches` in `manifest.json` aan.
