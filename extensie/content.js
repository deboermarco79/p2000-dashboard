// Brug tussen de pagina en de achtergrondtaak van de extensie.
document.documentElement.dataset.politieExtensie = '1';
window.addEventListener('message', e => {
    const d = e.data;
    if (e.source !== window || !d || d.type !== 'politie-vraag') return;
    chrome.runtime.sendMessage({ url: d.url }, r => window.postMessage({ type: 'politie-antwoord', id: d.id, ...(r || { status: 0, body: '' }) }, '*'));
});
