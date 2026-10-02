// Haalt api.politie.nl op voor de pagina (alleen api./rss.politie.nl, alleen GET).
chrome.runtime.onMessage.addListener((msg, _afzender, antwoord) => {
    if (!msg || typeof msg.url !== 'string' || !/^https:\/\/(api|rss)\.politie\.nl\//.test(msg.url)) { antwoord({ status: 0, body: '' }); return; }
    fetch(msg.url, { headers: { Accept: 'application/json' } })
        .then(async r => antwoord({ status: r.status, body: r.status === 204 ? '' : await r.text() }))
        .catch(e => antwoord({ status: 0, body: String(e && e.message || e) }));
    return true;
});
