/* Haalt de politie-RSS-feeds (rss.politie.nl, Noord-Holland) rechtstreeks vanuit de browser op en leest ze uit.
 * Vercel wordt door de politie geblokkeerd (403); een gewone verbinding niet. Geeft items als { bron, titel, tekst, datum, plaatje, url }. */
(function () {
    const abs = u => !u ? '' : /^https?:/.test(u) ? u : 'https://www.politie.nl' + (u.startsWith('/') ? '' : '/') + u;
    const schoon = t => String(t || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400);
    // De politie stuurt geen CORS-toestemming voor ons domein mee. Met de Chrome-extensie (map extensie/) lukt het
    // wel: die haalt de data via de eigen verbinding op en geeft hem door aan de pagina.
    let volgnr = 0;
    // Een iframe met sandbox heeft de herkomst "null"; de politie-API laat die soms wel lezen terwijl hij ons domein weigert.
    let sandbox = null;
    function haalViaSandbox(url) {
        if (!sandbox) {
            const f = document.createElement('iframe');
            f.setAttribute('sandbox', 'allow-scripts'); f.style.display = 'none';
            f.srcdoc = '<script>addEventListener("message",async e=>{const d=e.data;try{const r=await fetch(d.url);' +
                'parent.postMessage({sandboxId:d.id,status:r.status,body:await r.text()},"*")}catch(x){parent.postMessage({sandboxId:d.id,status:0,body:String(x)},"*")}})<\/script>';
            sandbox = { f, klaar: new Promise(k => { f.onload = k; }) };
            document.body.appendChild(f);
        }
        return sandbox.klaar.then(() => new Promise((klaar, fout) => {
            const id = ++volgnr;
            const timer = setTimeout(() => { window.removeEventListener('message', luister); fout(new Error('sandbox reageert niet')); }, 15000);
            function luister(e) {
                const d = e.data;
                if (e.source !== sandbox.f.contentWindow || !d || d.sandboxId !== id) return;
                clearTimeout(timer); window.removeEventListener('message', luister);
                if (!d.status) { fout(new Error('sandbox: ' + d.body)); return; }
                klaar({ status: d.status, ok: d.status >= 200 && d.status < 300, json: async () => JSON.parse(d.body) });
            }
            window.addEventListener('message', luister);
            sandbox.f.contentWindow.postMessage({ id, url }, '*');
        }));
    }
    function haal(url) {
        if (!document.documentElement.dataset.politieExtensie) return haalViaSandbox(url).catch(() => fetch(url));
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
    // De RSS-feeds van politie.nl (provinciefeeds): zelfde route, XML uitlezen in de browser.
    const FEEDS = ['https://rss.politie.nl/rss/ob/provincies/noord-holland.xml', 'https://rss.politie.nl/rss/ab/provincies/noord-holland.xml'];
    async function leesFeed(url) {
        const r = await haal(url);
        if (!r.ok) throw new Error('rss HTTP ' + r.status);
        const doc = new DOMParser().parseFromString(await r.text(), 'text/xml');
        return Array.from(doc.querySelectorAll('item')).map(i => {
            const t = n => { const e = i.querySelector(n); return e ? e.textContent : ''; };
            const media = i.querySelector('enclosure[url], content[url], thumbnail[url]');
            const html = (t('description').match(/<img[^>]+src=["']([^"']+)/i) || [])[1] || '';
            return { bron: 'Politie Noord-Holland', titel: schoon(t('title')), tekst: schoon(t('description')), datum: t('pubDate'),
                url: t('link'), plaatje: abs((media && media.getAttribute('url')) || html) };
        });
    }
    async function nieuwsViaRss(max) {
        const per = (await Promise.all(FEEDS.map(u => leesFeed(u).catch(() => [])))).filter(g => g.length);
        const uit = [];
        for (let i = 0; per.some(g => i < g.length); i++) per.forEach(g => { if (g[i]) uit.push(g[i]); });
        if (!uit.length) throw new Error('rss-feeds niet bereikbaar');
        return uit.slice(0, max);
    }

    window.politieNieuwsBrowser = nieuwsViaRss;
})();
