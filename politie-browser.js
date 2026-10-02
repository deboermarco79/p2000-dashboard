/* Haalt politienieuws rechtstreeks vanuit de browser op. api.politie.nl blokkeert de servers van Vercel
 * (403), maar een gewone (thuis)verbinding niet, en de API staat CORS toe. Filter: Eenheid Noord-Holland
 * (url eindigt op /04-...). Geeft items terug als { bron, titel, tekst, datum, plaatje, url }. */
(function () {
    const EENHEID = '04';
    const abs = u => !u ? '' : /^https?:/.test(u) ? u : 'https://www.politie.nl' + (u.startsWith('/') ? '' : '/') + u;
    const schoon = t => String(t || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400);
    window.politieNieuwsBrowser = async function (max) {
        const uit = [];
        for (let offset = 0; offset < 200 && uit.length < max; offset += 25) {
            const r = await fetch('https://api.politie.nl/v4/nieuws?language=nl&maxnumberofitems=25&offset=' + offset);
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
