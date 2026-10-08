/**
 * Server-side deel van het P2000-dashboard als Google Apps Script-webapp.
 *
 * Apps Script draait dit server-naar-server (UrlFetchApp), dus zonder CORS-beperking
 * en zonder de hele reeks client-side proxy-fallbacks die index.html op Vercel nodig
 * heeft. Alleen de feeds in TOEGESTAAN mogen opgehaald worden.
 */

var TOEGESTAAN = [
  'https://www.alarmeringdroid.nl/rss/7738690e',
  'https://www.alarmeringdroid.nl/rss/5ef7e920',
  'https://www.alarmeringdroid.nl/rss/132e8974',
  'https://www.alarmeringdroid.nl/rss/6fa78810',
  'https://www.alarmeringdroid.nl/rss/a067947f',
  'https://112hier.nl/feed.json?capcodes=0127850',
  'https://112hier.nl/feed.json?capcodes=0104972',
  'https://112hier.nl/feed.json?capcodes=0127185',
  'https://112hier.nl/feed.json?capcodes=0205625',
];

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Persalarm')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Eén feed-URL ophalen (server-naar-server, dus geen CORS). Wordt vanuit Index.html
 * aangeroepen via google.script.run. Geeft altijd een object terug (nooit een gooide
 * fout naar de client) zodat één trage/falende feed de andere niet blokkeert.
 */
function haalFeed(url) {
  if (TOEGESTAAN.indexOf(url) === -1) {
    return { ok: false, fout: 'niet-toegestane URL' };
  }
  try {
    var res = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      followRedirects: true,
      validateHttpsCertificates: true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        'Accept-Language': 'nl-NL,nl;q=0.9,en;q=0.8',
      },
    });
    var code = res.getResponseCode();
    if (code < 200 || code >= 300) {
      return { ok: false, fout: 'HTTP ' + code };
    }
    return { ok: true, tekst: res.getContentText() };
  } catch (e) {
    return { ok: false, fout: e && e.message ? e.message : String(e) };
  }
}

/**
 * Alle feeds in TOEGESTAAN parallel genoeg ophalen (Apps Script heeft geen echte
 * Promise.all, maar UrlFetchApp.fetchAll doet de verzoeken wel gelijktijdig).
 * Geeft een object {url: {ok, tekst|fout}} terug, in dezelfde volgorde als TOEGESTAAN.
 */
function haalAlleFeeds() {
  var verzoeken = TOEGESTAAN.map(function (url) {
    return {
      url: url,
      muteHttpExceptions: true,
      followRedirects: true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        'Accept-Language': 'nl-NL,nl;q=0.9,en;q=0.8',
      },
    };
  });
  var resultaten = {};
  try {
    var antwoorden = UrlFetchApp.fetchAll(verzoeken);
    antwoorden.forEach(function (res, i) {
      var url = TOEGESTAAN[i];
      try {
        var code = res.getResponseCode();
        if (code >= 200 && code < 300) {
          resultaten[url] = { ok: true, tekst: res.getContentText() };
        } else {
          resultaten[url] = { ok: false, fout: 'HTTP ' + code };
        }
      } catch (e) {
        resultaten[url] = { ok: false, fout: e && e.message ? e.message : String(e) };
      }
    });
  } catch (e) {
    // fetchAll zelf kan falen (bv. bij een ongeldig verzoek); val terug op één voor één
    TOEGESTAAN.forEach(function (url) {
      resultaten[url] = haalFeed(url);
    });
  }
  return resultaten;
}
