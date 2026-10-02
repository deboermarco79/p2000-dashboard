// Edge Function die api.politie.nl aanroept. Edge draait op een ander netwerk dan Vercel's gewone
// serverless functies (AWS Lambda), waarvan de IP's door de politie geblokkeerd worden (403).
// Alleen de drie endpoints hieronder zijn toegestaan, de API-sleutel blijft in Vercel (POLITIE_API_KEY).
export const config = { runtime: 'edge', regions: ['arn1', 'cdg1', 'lhr1', 'dub1', 'fra1'] };

const TOEGESTAAN = ['/v4/nieuws', '/v5/gezocht', '/v5/vermist'];

export default async function handler(req) {
    const u = new URL(req.url);
    const pad = u.searchParams.get('pad') || '';
    const [route, query = ''] = pad.split('?');
    if (!TOEGESTAAN.includes(route)) return new Response('Niet toegestaan', { status: 400 });
    const sleutel = process.env.POLITIE_API_KEY;
    const r = await fetch('https://api.politie.nl' + route + '?' + query, {
        headers: { Accept: 'application/json', ...(sleutel ? { 'x-api-key': sleutel } : {}),
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36' },
    });
    return new Response(r.status === 204 ? null : await r.text(), { status: r.status, headers: { 'Content-Type': 'application/json' } });
}
