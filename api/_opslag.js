// Kleine opslag in Upstash Redis (gratis via Vercel Marketplace), alleen met fetch, zonder pakketten.
// Vercel zet de variabelen zelf als je de Upstash-integratie koppelt (KV_REST_API_* of UPSTASH_REDIS_REST_*).
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';

async function opdracht(cmd) {
    if (!URL_ || !TOKEN) throw new Error('opslag niet ingesteld (Upstash Redis koppelen in Vercel)');
    const r = await fetch(URL_, { method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) });
    if (!r.ok) throw new Error('opslag HTTP ' + r.status);
    return (await r.json()).result;
}

module.exports = {
    lees: async sleutel => { const t = await opdracht(['GET', sleutel]); return t ? JSON.parse(t) : null; },
    schrijf: (sleutel, waarde) => opdracht(['SET', sleutel, JSON.stringify(waarde)]),
    beschikbaar: !!(URL_ && TOKEN),
};
