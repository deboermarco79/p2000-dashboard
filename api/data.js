// Vercel serverless function voor narrowcast.html: weer, nieuws en sociale media.
// Bereikbaar als /data/weer, /data/nieuws en /data/social (zie vercel.json).
//
// Instellen kan hieronder, of via omgevingsvariabelen in Vercel (Settings > Environment Variables):
//   WEER_PLAATS, WEER_LAT, WEER_LON
//   NIEUWS_FEEDS en SOCIAL_FEEDS, elk als "Naam|https://rss-url" gescheiden door komma's
//   (bijv. SOCIAL_FEEDS="Gemeente|https://mastodon.nl/@naam.rss")
const lijst = (env, standaard) => env
    ? env.split(',').map(s => s.trim().split('|')).filter(d => d.length === 2)
    : standaard;

const WEER = {
    plaats: process.env.WEER_PLAATS || 'Zaandam',
    lat: process.env.WEER_LAT || '52.44',
    lon: process.env.WEER_LON || '4.83',
};
const NIEUWS = lijst(process.env.NIEUWS_FEEDS, [
    ['Politie Noord-Holland', 'https://rss.politie.nl/rss/ob/provincies/noord-holland.xml'],
    ['Politie Noord-Holland', 'https://rss.politie.nl/rss/ab/provincies/noord-holland.xml'],
]);
// Politie-API (https://api.politie.nl). Nieuws heeft geen sleutel nodig; gezocht/vermist (v5) wel:
// zet POLITIE_API_KEY in Vercel. Berichten van Eenheid Noord-Holland hebben een url die met "04-" begint.
const POLITIE = 'https://api.politie.nl';
const EENHEID = process.env.POLITIE_EENHEID || '04';
const POLITIE_KEY = process.env.POLITIE_API_KEY || '';

const absoluut = u => !u ? '' : /^https?:/.test(u) ? u : 'https://www.politie.nl' + (u.startsWith('/') ? '' : '/') + u;
const eersteFoto = b => absoluut((b.afbeelding && b.afbeelding.url) || (b.afbeeldingen && b.afbeeldingen[0] && b.afbeeldingen[0].url)
    || (b.meerAfbeeldingen && b.meerAfbeeldingen[0] && b.meerAfbeeldingen[0].url)
    || (b.verdachteRepresentation && b.verdachteRepresentation.signalementen && b.verdachteRepresentation.signalementen[0]
        && b.verdachteRepresentation.signalementen[0].afbeelding && b.verdachteRepresentation.signalementen[0].afbeelding.url) || '');
const naarItem = (bron, b) => ({ bron, titel: b.titel || b.title || '', tekst: ontsnap(b.introductie || b.omschrijving || ''),
    datum: b.publicatieDatum || '', plaatje: eersteFoto(b), url: b.url || '' });
// "04-" aan het begin van de bestandsnaam in de url, bijv. .../nieuws/2026/oktober/1/04-brand-in-zaandam.html
const vanEenheid = b => new RegExp('/' + EENHEID + '-[^/]*$').test(((b.url || b.path || '') + '').split('?')[0]);

async function politieJson(pad, kop) {
    // Sleutel altijd meesturen als hij er is (sommige omgevingen vragen hem ook voor v4).
    // Bij een 403 een tweede poging met een andere User-Agent: de API kan op de ene of de andere weigeren.
    const sleutel = POLITIE_KEY ? { 'x-api-key': POLITIE_KEY } : {};
    const agents = ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36', 'narrowcasting/1.0'];
    let r;
    for (const ua of agents) {
        r = await fetch(POLITIE + pad, { headers: { Accept: 'application/json', ...sleutel, ...kop, 'User-Agent': ua } });
        if (r.status !== 403) break;
    }
    if (r.status === 204) return null;
    if (!r.ok) throw new Error('politie-api HTTP ' + r.status + ' ' + (await r.text()).replace(/\s+/g, ' ').slice(0, 150));
    return r.json();
}

// Nieuws van Eenheid Noord-Holland: de API kent geen eenheidfilter, dus pagina's (25 per keer) doorlopen
// en filteren op "04-" in de url, tot er vijf zijn of de lijst op is.
async function politieNieuws(max = 5) {
    const uit = [];
    for (let offset = 0; offset < 200 && uit.length < max; offset += 25) {
        const d = await politieJson('/v4/nieuws?language=nl&maxnumberofitems=25&offset=' + offset);
        if (!d) break;
        (d.nieuwsberichten || []).filter(vanEenheid).forEach(b => uit.push(naarItem('Nieuws Noord-Holland', b)));
        if (!d.iterator || d.iterator.last) break;
    }
    return uit.slice(0, max);
}

// Eerst de politie-API (Eenheid Noord-Holland). Weigert die (403/blokkade), dan de RSS-feeds van politie.nl
// (provinciefeeds, dus zonder eenheidfilter) zodat de kolom niet leeg blijft.
async function nieuwsMetVangnet() {
    try {
        const uit = await politieNieuws();
        if (uit.length) return uit;
    } catch (e) { /* vangnet hieronder */ }
    const uit = await feeds(NIEUWS);
    if (!uit.length) throw new Error('politie-api en RSS-feeds beide niet bereikbaar');
    return uit.slice(0, 5);
}

// Gezocht en vermist (v5, met sleutel): afwisselend, alleen eenheid Noord-Holland.
async function politieGezocht(max = 5) {
    if (!POLITIE_KEY) throw new Error('POLITIE_API_KEY ontbreekt');
    const kop = { 'x-api-key': POLITIE_KEY };
    const [g, v] = await Promise.all(['gezocht', 'vermist'].map(async pad => {
        const d = await politieJson('/v5/' + pad + '?language=nl&maxnumberofitems=25', kop);
        const lijst = Array.isArray(d) ? d : (d && (d.opsporingsberichten || d.vermisten || d.items)) || [];
        return lijst.filter(vanEenheid).map(b => naarItem(pad === 'gezocht' ? 'Gezocht' : 'Vermist', b));
    }));
    const uit = [];
    for (let i = 0; uit.length < max && (i < g.length || i < v.length); i++) { if (g[i]) uit.push(g[i]); if (v[i]) uit.push(v[i]); }
    return uit.slice(0, max);
}

const SOCIAL = lijst(process.env.SOCIAL_FEEDS, []);

const ontsnap = t => t
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ').trim();

async function haal(url) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    try {
        const r = await fetch(url, { signal: ctrl.signal, headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
            Accept: 'application/rss+xml, application/xml, text/xml, */*',
            'Accept-Language': 'nl-NL,nl;q=0.9,en;q=0.8',
            Referer: new URL(url).origin + '/',
        } });
        if (!r.ok) throw new Error(r.status);
        return r;
    } finally { clearTimeout(timer); }
}

async function leesRss(naam, url, max = 8) {
    const xml = await (await haal(url)).text();
    const uit = [];
    for (const m of xml.matchAll(/<item\b[\s\S]*?<\/item>/g)) {
        const blok = m[0];
        const veld = tag => { const x = blok.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)</' + tag + '>')); return x ? ontsnap(x[1]) : ''; };
        const plaatje = (blok.match(/<(?:media:content|media:thumbnail|enclosure)\b[^>]*\burl="([^"]+)"[^>]*>/) || [])[1] || '';
        const plaatjeInHtml = (blok.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&quot;/g, '"').match(/<img[^>]+src=["']([^"']+)/i) || [])[1] || '';
        uit.push({ bron: naam, titel: veld('title'), tekst: veld('description').slice(0, 400), datum: veld('pubDate'), plaatje: plaatje || plaatjeInHtml.replace(/&amp;/g, '&') });
        if (uit.length >= max) break;
    }
    return uit;
}

async function feeds(lijstje) {
    const per = (await Promise.all(lijstje.map(([n, u]) => leesRss(n, u).catch(() => [])))).filter(g => g.length);
    const uit = [];
    for (let i = 0; per.some(g => i < g.length); i++) per.forEach(g => { if (g[i]) uit.push(g[i]); });  // om en om per bron
    return uit;
}

async function weer() {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${WEER.lat}&longitude=${WEER.lon}&timezone=Europe%2FAmsterdam` +
        '&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,precipitation' +
        '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset' +
        '&wind_speed_unit=bft&forecast_days=5';
    return { ...(await (await haal(url)).json()), plaats: WEER.plaats };
}

async function handler(req, res) {
    const soort = req.query.soort;
    try {
        const data = soort === 'nieuws0' || soort === 'nieuws' ? await nieuwsMetVangnet()
            : soort === 'nieuws1' ? await politieGezocht()
            : soort === 'weer' ? await weer()
            : soort === 'social' ? await feeds(SOCIAL)
            : null;
        if (data === null) { res.status(404).send('Onbekend'); return; }
        res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
        res.status(200).json(data);
    } catch (fout) {
        res.status(502).send('Bron niet bereikbaar: ' + (fout && fout.message ? fout.message : fout));
    }
}

handler.config = { maxDuration: 20 };
module.exports = handler;
