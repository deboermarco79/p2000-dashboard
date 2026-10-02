// Cloudflare Worker (gratis): geeft api.politie.nl-verzoeken door vanaf Cloudflare's netwerk in plaats van Vercel's.
// Alleen /v4/nieuws, /v5/gezocht en /v5/vermist. Optioneel geheim: stel in Cloudflare de variabele TOKEN in
// en dezelfde waarde als POLITIE_PROXY_TOKEN in Vercel; zonder TOKEN is de Worker open voor deze drie paden.
const PADEN = ['/v4/nieuws', '/v5/gezocht', '/v5/vermist'];

export default {
    async fetch(req, env) {
        const u = new URL(req.url);
        const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'x-api-key, x-token' };
        if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
        if (env.TOKEN && req.headers.get('x-token') !== env.TOKEN) return new Response('Geen toegang', { status: 401, headers: cors });
        if (!PADEN.includes(u.pathname)) return new Response('Niet toegestaan', { status: 400, headers: cors });
        const kop = { Accept: 'application/json' };
        const sleutel = req.headers.get('x-api-key');
        if (sleutel) kop['x-api-key'] = sleutel;
        const r = await fetch('https://api.politie.nl' + u.pathname + u.search, { headers: kop });
        return new Response(r.status === 204 ? null : await r.text(), { status: r.status, headers: { ...cors, 'Content-Type': 'application/json' } });
    },
};
