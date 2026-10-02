/* Haalt politienieuws rechtstreeks vanuit de browser op. api.politie.nl blokkeert de servers van Vercel
 * (403), maar een gewone (thuis)verbinding niet, en de API staat CORS toe. Filter: Eenheid Noord-Holland
 * (url eindigt op /04-...). Geeft items terug als { bron, titel, tekst, datum, plaatje, url }. */
(function () {
    const EENHEID = '04';
    const abs = u => !u ? '' : /^https?:/.test(u) ? u : 'https://www.politie.nl' + (u.startsWith('/') ? '' : '/') + u;
    const schoon = t => String(t || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400);
    // De politie stuurt geen CORS-toestemming voor ons domein mee. Met de Chrome-extensie (map extensie/) lukt het
    // wel: die haalt de data via de eigen verbinding op en geeft hem door aan de pagina.
    let volgnr = 0;
    function haal(url) {
        if (!document.documentElement.dataset.politieExtensie) return fetch(url);
        return new Promise((klaar, fout) => {
            const id = ++volgnr;
            const timer = setTimeout(() => { window.removeEventListener('message', luister); fout(new Error('extensie reageert niet')); }, 15000);
            function luister(e) {
                const d = e.data;
                if (e.source !== window || !d || d.type !== 'politie-antwoord' || d.id !== id) return;
                clearTimeout(timer); window.removeEventListener('message', luister);
                if (!d.status) { fout(new Error('extensie: ' + (d.body || 'geen verbinding'))); return; }
                klaar({ status: d.status, ok: d.status >= 200 && d.status < 300, json: async () => JSON.parse(d.body) });
            }
            window.addEventListener('message', luister);
            window.postMessage({ type: 'politie-vraag', id, url }, '*');
        });
    }
    window.politieNieuwsBrowser = async function (max) {
        const uit = [];
        for (let offset = 0; offset < 200 && uit.length < max; offset += 25) {
            const r = await haal('https://api.politie.nl/v4/nieuws?language=nl&maxnumberofitems=25&offset=' + offset);
            if (r.status === 204) break;
            if (!r.ok) throw new Error('politie-api HTTP ' + r.status);
            const d = await r.json();
            (d.nieuwsberichten || []).filter(b => new RegExp('/' + EENHEID + '-[^/]*$').test(String(b.url || b.path || '').split('?')[0]))
                .forEach(b => uit.push({
                    bron: 'Nieuws Noord-Holland', titel: b.titel || '', tekst: schoon(b.introductie || b.omschrijving),
                    datum: b.publicatieDatum || '', url: b.url || '',
                    plaatje: abs((b.afbeelding && b.afbeelding.url) || (b.afbeeldingen && b.afbeeldingen[0] && b.afbeeldingen[0].url)
                        || (b.meerAfbeeldingen && b.meerAfbeeldingen[0] && b.meerAfbeeldingen[0].url)),
                }));
            if (!d.iterator || d.iterator.last) break;
        }
        if (!uit.length) throw new Error('geen berichten van eenheid ' + EENHEID);
        return uit.slice(0, max);
    };
})();
