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
        const kolom = /^nieuws([01])$/.exec(soort || '');
        const data = kolom ? await leesRss(NIEUWS[kolom[1]][0], NIEUWS[kolom[1]][1], 5)
            : soort === 'weer' ? await weer()
            : soort === 'nieuws' ? await feeds(NIEUWS)
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
