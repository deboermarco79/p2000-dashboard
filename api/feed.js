// Vercel serverless function: haalt een P2000-feed zelf op en geeft hem door.
//
// Een browser mag de feed niet rechtstreeks lezen (CORS), en gratis publieke
// CORS-proxies (allorigins, codetabs, ...) zijn wisselvallig en kunnen ineens
// blokkeren of traag worden. Deze functie draait op Vercel's eigen servers en
// haalt de feed daar vandaan op: dat is een gewoon server-naar-server verzoek,
// dus zonder CORS-beperking en zonder afhankelijkheid van een externe proxy.
//
// Alleen de feeds hieronder mogen opgehaald worden (geen open proxy voor
// willekeurige URL's).
const TOEGESTAAN = [
    'https://alarmeringen.nl/feeds/user/e3826aac-12d9-4685-be9e-e30a469de97c.rss',
    'https://www.alarmeringdroid.nl/rss/7738690e',
    'https://alarmeringen.nl/feeds/user/edc2a4dd-b5ed-430c-85a7-7caf1982545f.rss',
    'https://www.alarmeringdroid.nl/rss/5ef7e920',
    'https://www.alarmeringdroid.nl/rss/132e8974',
    'https://www.alarmeringdroid.nl/rss/6fa78810',
    'https://www.alarmeringdroid.nl/rss/a067947f',
];

async function handler(req, res) {
    const url = typeof req.query.url === 'string' ? req.query.url : '';

    if (!TOEGESTAAN.includes(url)) {
        res.status(400).send('Onbekende of niet-toegestane feed-URL');
        return;
    }

    const stuurGeen = () => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        // Op de rand van Vercel's CDN 20 s cachen: haalt de bron niet vaker op dan nodig,
        // ook al vragen meerdere kijkers (of de eerste 60 s-poging en een snelle herprobeer) tegelijk.
        res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=40');
    };

    // Ruim onder Vercel's functietijdslimiet (zie maxDuration hierboven), zodat dit een
    // nette foutmelding teruggeeft in plaats van dat Vercel de functie hardhandig afbreekt.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
        const upstream = await fetch(url, {
            signal: ctrl.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
                Accept: 'application/rss+xml, application/xml, text/xml, */*',
                'Accept-Language': 'nl-NL,nl;q=0.9,en;q=0.8',
                Referer: new URL(url).origin + '/',
            },
        });
        const tekst = await upstream.text();
        stuurGeen();
        res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/rss+xml; charset=utf-8');
        res.status(upstream.ok ? 200 : 502).send(tekst);
    } catch (fout) {
        stuurGeen();
        res.status(502).send('Feed niet bereikbaar vanaf de server: ' + (fout && fout.message ? fout.message : fout));
    } finally {
        clearTimeout(timer);
    }
}

// Sommige bronnen zijn trager voor drukbezochte feeds of weren duidelijk herkenbare bots.
// Geef de functie dus wat extra tijd (Vercel staat dit toe op de meeste tiers) en stuur
// headers mee die op een gewone browser lijken, in plaats van een opvallende eigen naam.
handler.config = { maxDuration: 20 };
module.exports = handler;
