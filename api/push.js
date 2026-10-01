// Ontvangt politie-data van een apparaat thuis (Home Assistant) en bewaart die voor nieuws.html.
// Nodig omdat api.politie.nl de servers van Vercel blokkeert (HTTP 403), maar een thuisverbinding niet.
//
//   POST /api/push?soort=nieuws|gezocht|vermist&offset=0
//   Header  x-push-token: <PUSH_TOKEN uit Vercel>
//   Body    het ongewijzigde JSON-antwoord van api.politie.nl voor die pagina (offset 0, 25, 50, 75)
//
// offset=0 begint een nieuwe lijst, hogere offsets vullen die aan. Alleen berichten van Eenheid
// Noord-Holland (url-bestandsnaam begint met "04-") worden bewaard, maximaal vijf.
const opslag = require('./_opslag');
const EENHEID = process.env.POLITIE_EENHEID || '04';
const abs = u => !u ? '' : /^https?:/.test(u) ? u : 'https://www.politie.nl' + (u.startsWith('/') ? '' : '/') + u;
const schoon = t => String(t || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400);
const foto = b => abs((b.afbeelding && b.afbeelding.url) || (b.afbeeldingen && b.afbeeldingen[0] && b.afbeeldingen[0].url)
    || (b.meerAfbeeldingen && b.meerAfbeeldingen[0] && b.meerAfbeeldingen[0].url)
    || (((b.verdachteRepresentation || {}).signalementen || [])[0] || {}).afbeelding && b.verdachteRepresentation.signalementen[0].afbeelding.url || '');
const LABEL = { nieuws: 'Nieuws Noord-Holland', gezocht: 'Gezocht', vermist: 'Vermist' };

async function handler(req, res) {
    const token = process.env.PUSH_TOKEN;
    if (!token || req.headers['x-push-token'] !== token) { res.status(401).send('Geen toegang'); return; }
    if (req.method !== 'POST') { res.status(405).send('Alleen POST'); return; }
    const soort = req.query.soort;
    if (!LABEL[soort]) { res.status(400).send('Onbekende soort'); return; }
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body || 'null') : req.body;
        const lijst = Array.isArray(body) ? body : (body && (body.nieuwsberichten || body.opsporingsberichten || body.vermisten || body.items)) || [];
        const nieuw = lijst
            .filter(b => new RegExp('/' + EENHEID + '-[^/]*$').test(String(b.url || b.path || '').split('?')[0]))
            .map(b => ({ bron: LABEL[soort], titel: b.titel || '', tekst: schoon(b.introductie || b.omschrijving), datum: b.publicatieDatum || '', plaatje: foto(b), url: b.url || '' }));
        const begin = Number(req.query.offset || 0) === 0;
        const bestaand = begin ? [] : ((await opslag.lees('politie:' + soort)) || {}).items || [];
        const gezien = new Set(bestaand.map(i => i.url));
        const items = bestaand.concat(nieuw.filter(i => !gezien.has(i.url))).slice(0, 5);
        await opslag.schrijf('politie:' + soort, { bijgewerkt: new Date().toISOString(), items });
        res.status(200).json({ bewaard: items.length });
    } catch (fout) {
        res.status(500).send('Bewaren mislukt: ' + (fout && fout.message ? fout.message : fout));
    }
}
module.exports = handler;
