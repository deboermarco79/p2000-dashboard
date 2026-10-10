'use strict';
/**
 * Tests voor de pure logica (geen dependencies): node tests/logic.test.js
 * - Server-logica: ../Code.gs (via module.exports)
 * - Client-logica: tussen "// <pure>" en "// </pure>" in ../Index.html
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const server = require('../Code.gs');
const html = fs.readFileSync(path.join(__dirname, '..', 'Index.html'), 'utf8');

const pureMatch = html.match(/\/\/ <pure>([\s\S]*?)\/\/ <\/pure>/);
assert.ok(pureMatch, 'Markers // <pure> ... // </pure> niet gevonden in Index.html');
const client = new Function(pureMatch[1] + `
  return { normalizeCaption, truncateAtWord, prepareCaption, formatFollowers, parseInstagramTimestamp,
           getZonedParts, formatRelativeTime, nextPollDelay, shouldReloadNow };`)();

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failures.push(name); console.log('  FAIL ' + name + '\n       ' + String(e.message).split('\n').join('\n       ')); }
}

// Intl-variant van Utilities.formatDate voor de patronen die Code.gs gebruikt.
function intlFormatter(date, tz, pattern) {
  const parts = {};
  new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(date).forEach(p => { parts[p.type] = p.value; });
  if (pattern === 'HH:mm') return parts.hour + ':' + parts.minute;
  if (pattern === 'yyyy-MM-dd') return parts.year + '-' + parts.month + '-' + parts.day;
  throw new Error('patroon niet ondersteund in test: ' + pattern);
}
const inWindow = iso => { const c = server.getAmsterdamClock(new Date(iso), intlFormatter); return server.isWithinWindow(c.hour, c.minute); };

console.log('Venster (07:00 <= t < 22:00)');
test('06:59 nee, 07:00 ja, 21:59 ja, 22:00 nee', () => {
  assert.equal(server.isWithinWindow(6, 59), false);
  assert.equal(server.isWithinWindow(7, 0), true);
  assert.equal(server.isWithinWindow(21, 59), true);
  assert.equal(server.isWithinWindow(22, 0), false);
  assert.equal(server.isWithinWindow(0, 0), false);
  assert.equal(server.isWithinWindow(12, 30), true);
});
test('zomertijd (CEST, UTC+2) gewone dag', () => {
  assert.equal(inWindow('2026-10-10T04:59:00Z'), false); // 06:59
  assert.equal(inWindow('2026-10-10T05:00:00Z'), true);  // 07:00
  assert.equal(inWindow('2026-10-10T19:59:00Z'), true);  // 21:59
  assert.equal(inWindow('2026-10-10T20:00:00Z'), false); // 22:00
});
test('DST-dag 2026-03-29 (CET -> CEST om 01:00 UTC)', () => {
  assert.deepEqual(server.getAmsterdamClock(new Date('2026-03-29T00:59:00Z'), intlFormatter), { hour: 1, minute: 59 });
  assert.deepEqual(server.getAmsterdamClock(new Date('2026-03-29T01:00:00Z'), intlFormatter), { hour: 3, minute: 0 });
  assert.equal(inWindow('2026-03-29T04:59:00Z'), false); // 06:59 CEST
  assert.equal(inWindow('2026-03-29T05:00:00Z'), true);  // 07:00 CEST
  assert.equal(inWindow('2026-03-29T19:59:00Z'), true);  // 21:59 CEST
  assert.equal(inWindow('2026-03-29T20:00:00Z'), false); // 22:00 CEST
});
test('DST-dag 2026-10-25 (CEST -> CET om 01:00 UTC)', () => {
  assert.deepEqual(server.getAmsterdamClock(new Date('2026-10-25T00:59:00Z'), intlFormatter), { hour: 2, minute: 59 });
  assert.deepEqual(server.getAmsterdamClock(new Date('2026-10-25T01:00:00Z'), intlFormatter), { hour: 2, minute: 0 });
  assert.equal(inWindow('2026-10-25T05:59:00Z'), false); // 06:59 CET
  assert.equal(inWindow('2026-10-25T06:00:00Z'), true);  // 07:00 CET
  assert.equal(inWindow('2026-10-25T20:59:00Z'), true);  // 21:59 CET
  assert.equal(inWindow('2026-10-25T21:00:00Z'), false); // 22:00 CET
});
test('datumsleutel volgt Amsterdam, niet UTC', () => {
  assert.equal(server.getAmsterdamDateKey(new Date('2026-10-10T22:30:00Z'), intlFormatter), '2026-10-11');
});

console.log('shouldSync (interval 25 min)');
test('grenzen van het interval', () => {
  const now = Date.UTC(2026, 9, 10, 10, 0, 0);
  const min = m => m * 60000;
  assert.equal(server.shouldSync(now, now - min(24) - 59000), false);
  assert.equal(server.shouldSync(now, now - min(25)), true);
  assert.equal(server.shouldSync(now, now - min(30)), true);
  assert.equal(server.shouldSync(now, now - min(1)), false);
  assert.equal(server.shouldSync(now, NaN), true);
  assert.equal(server.shouldSync(now, undefined), true);
  assert.equal(server.shouldSync(now, now + min(10)), true); // klok teruggezet
});

console.log('Caption inkorten (server, 600 tekens)');
test('kort en exact op de grens blijft ongewijzigd', () => {
  assert.equal(server.truncateCaption('Hallo'), 'Hallo');
  const exact = 'a'.repeat(600);
  assert.equal(server.truncateCaption(exact), exact);
  assert.equal(server.truncateCaption(null), '');
});
test('lange tekst wordt op woordgrens afgekapt, max 600', () => {
  const text = 'woord '.repeat(200);
  const out = server.truncateCaption(text);
  assert.ok(out.length <= 600);
  assert.ok(out.endsWith('woord…'), out.slice(-20));
});
test('lang woord zonder spaties: harde knip, geen gebroken emoji', () => {
  const out = server.truncateCaption('\u{1F600}'.repeat(400));
  assert.ok(out.length <= 600);
  assert.ok(!/[\uD800-\uDBFF]…$/.test(out), 'losse high surrogate voor de ellips');
  assert.equal(Buffer.from(out, 'utf8').toString('utf8'), out);
  const out2 = server.truncateCaption('a'.repeat(1000));
  assert.equal(out2.length, 600);
});
test('emoji op de grens wordt nooit gesplitst', () => {
  for (let pad = 590; pad <= 600; pad++) {
    const out = server.truncateCaption('x'.repeat(pad) + '\u{1F44D}\u{1F44D}\u{1F44D} einde');
    assert.ok(out.length <= 600);
    assert.ok(!/[\uD800-\uDBFF](…)?$/.test(out), 'gesplitst bij pad=' + pad);
  }
});

console.log('Server: API-hulpfuncties');
test('pickMediaUrl per mediatype', () => {
  assert.equal(server.pickMediaUrl({ media_type: 'IMAGE', media_url: 'u1', thumbnail_url: 't' }), 'u1');
  assert.equal(server.pickMediaUrl({ media_type: 'CAROUSEL_ALBUM', media_url: 'u2' }), 'u2');
  assert.equal(server.pickMediaUrl({ media_type: 'VIDEO', media_url: 'v', thumbnail_url: 't3' }), 't3');
  assert.equal(server.pickMediaUrl({ media_type: 'IMAGE' }), null);
  assert.equal(server.pickMediaUrl({ media_type: 'VIDEO', media_url: 'v' }), null);
});
test('parseApiResponse: met en zonder bericht, en ongeldig', () => {
  const ok = server.parseApiResponse({ followers_count: 10, username: 'x', media: { data: [{ id: '1', caption: 'c', media_type: 'IMAGE', media_url: 'u', permalink: 'p', timestamp: 't' }] } });
  assert.equal(ok.ok, true); assert.equal(ok.post.mediaUrl, 'u'); assert.equal(ok.followers, 10);
  const none = server.parseApiResponse({ followers_count: 5, username: 'x' });
  assert.equal(none.ok, true); assert.equal(none.post, null);
  assert.equal(server.parseApiResponse({ id: '1' }).ok, false);
  assert.equal(server.parseApiResponse(null).ok, false);
});
test('classifyError: 190, rate-limits, 100/33, 5xx, netwerk', () => {
  assert.equal(server.classifyError(400, { error: { code: 190, message: 'Invalid OAuth 2.0 Access Token' } }).kind, 'token');
  [4, 17, 32, 613].forEach(c => assert.equal(server.classifyError(400, { error: { code: c } }).kind, 'rate', 'code ' + c));
  const cfg = server.classifyError(400, { error: { code: 100, error_subcode: 33, message: 'Unsupported get request.' } });
  assert.equal(cfg.kind, 'config'); assert.equal(cfg.subcode, 33); assert.equal(cfg.retryable, false);
  const t = server.classifyError(503, null);
  assert.equal(t.kind, 'transient'); assert.equal(t.retryable, true);
  assert.equal(server.classifyError(0, null).kind, 'transient');
  assert.equal(server.classifyError(400, { error: { code: 999 } }).kind, 'api');
  assert.equal(server.classifyError(404, null).kind, 'http');
});
test('validateConfig: placeholder, "me" op facebook-host, host/versie', () => {
  const base = { token: 'abc', igUserId: 'me', apiHost: 'https://graph.instagram.com', graphVersion: 'v25.0' };
  assert.deepEqual(server.validateConfig(base), []);
  assert.equal(server.validateConfig({ ...base, token: 'PLAK_HIER_JE_TOKEN' }).length, 1);
  assert.equal(server.validateConfig({ ...base, token: '' }).length, 1);
  assert.equal(server.validateConfig({ ...base, apiHost: 'https://graph.facebook.com' }).length, 1);
  assert.deepEqual(server.validateConfig({ ...base, apiHost: 'https://graph.facebook.com', igUserId: '17841400000000000' }), []);
  assert.equal(server.validateConfig({ ...base, apiHost: 'https://evil.example' }).length, 1);
  assert.equal(server.validateConfig({ ...base, graphVersion: '25' }).length, 1);
});
test('buildApiUrl_ bevat de afgesproken velden', () => {
  const url = server.buildApiUrl_({ apiHost: 'https://graph.instagram.com', graphVersion: 'v25.0', igUserId: 'me', token: 'T' });
  const fields = decodeURIComponent(url.split('fields=')[1].split('&')[0]);
  assert.equal(fields, 'followers_count,username,media.limit(1){id,caption,media_type,media_url,thumbnail_url,permalink,timestamp}');
  assert.ok(url.startsWith('https://graph.instagram.com/v25.0/me?'));
});
test('token-leeftijd, alert-limiet, versie, sanitize', () => {
  assert.equal(server.needsTokenRefresh(40), false);
  assert.equal(server.needsTokenRefresh(40.01), true);
  assert.equal(server.isTokenTooOld(50), false);
  assert.equal(server.isTokenTooOld(51), true);
  const now = Date.parse('2026-10-10T10:00:00Z');
  assert.equal(Math.round(server.daysBetween('2026-08-31T10:00:00Z', now)), 40);
  assert.equal(server.daysBetween('onzin', now), null);
  assert.equal(server.shouldSendAlert('2026-10-10', '2026-10-10'), false);
  assert.equal(server.shouldSendAlert('2026-10-09', '2026-10-10'), true);
  assert.equal(server.shouldSendAlert(null, '2026-10-10'), true);
  assert.equal(server.buildVersion('123', '2026-10-10T10:00:00.000Z'), '123@2026-10-10T10:00:00.000Z');
  assert.equal(server.sanitizeMessage('fout met GEHEIM erin', 'GEHEIM'), 'fout met [token] erin');
});

console.log('Client: caption');
test('URLs en hashtag-blokken weg, inline hashtags en zinnen blijven', () => {
  const raw = 'Vanmiddag in #Haarlem een controle.\n\nMeer info: https://www.politie.nl/nieuws?x=1 of www.politie.nl\n.\n.\n#politie #fiets #NoordHolland';
  assert.equal(client.normalizeCaption(raw), 'Vanmiddag in #Haarlem een controle. Meer info: of');
});
test('hashtag-regels midden in de tekst en alleen-hashtags', () => {
  assert.equal(client.normalizeCaption('Eerste alinea.\n#een #twee\nTweede alinea.'), 'Eerste alinea. Tweede alinea.');
  assert.equal(client.normalizeCaption('#alleen #hashtags'), '');
  assert.equal(client.normalizeCaption('Tot ziens. #a #b'), 'Tot ziens.');
});
test('witruimte wordt genormaliseerd', () => {
  assert.equal(client.normalizeCaption('  a \t b\r\n\r\n\r\nc  '), 'a b c');
  assert.equal(client.normalizeCaption(null), '');
});
test('truncateAtWord: woordgrens, lang woord, emoji; gelijk aan server', () => {
  assert.equal(client.truncateAtWord('kort', 50), 'kort');
  const out = client.truncateAtWord('aaa bbb ccc ddd eee', 12);
  assert.ok(out.length <= 12); assert.equal(out, 'aaa bbb ccc…');
  const long = client.truncateAtWord('x'.repeat(100), 20);
  assert.equal(long.length, 20);
  const emoji = client.truncateAtWord('\u{1F600}'.repeat(30), 21);
  assert.ok(!/[\uD800-\uDBFF]…$/.test(emoji));
  ['aaa bbb ccc ddd eee', 'x'.repeat(100), '\u{1F600}'.repeat(30) + ' einde', 'woord '.repeat(50)].forEach(s => {
    [10, 21, 33].forEach(m => assert.equal(client.truncateAtWord(s, m), server.truncateCaption(s, m), s.slice(0, 10) + ' @' + m));
  });
});
test('prepareCaption begrenst op 420 tekens', () => {
  assert.ok(client.prepareCaption('woord '.repeat(300)).length <= 420);
});

console.log('Client: relatieve tijd');
const T = iso => Date.parse(iso);
const rel = (post, now) => client.formatRelativeTime(T(post), T(now));
test('seconden: 59 s zojuist, 60 s "1 minuut geleden"', () => {
  const post = '2026-10-10T10:00:00Z';
  assert.equal(rel(post, '2026-10-10T10:00:00Z'), 'zojuist');
  assert.equal(rel(post, '2026-10-10T10:00:59Z'), 'zojuist');
  assert.equal(rel(post, '2026-10-10T10:01:00Z'), '1 minuut geleden');
  assert.equal(rel(post, '2026-10-10T10:01:59Z'), '1 minuut geleden');
  assert.equal(rel(post, '2026-10-10T10:02:00Z'), '2 minuten geleden');
  assert.equal(rel(post, '2026-10-10T09:59:00Z'), 'zojuist'); // post "in de toekomst" (klokverschil)
});
test('minuten: 59 min nog minuten, 60 min "1 uur geleden"', () => {
  const post = '2026-10-10T10:00:00Z';
  assert.equal(rel(post, '2026-10-10T10:59:59Z'), '59 minuten geleden');
  assert.equal(rel(post, '2026-10-10T11:00:00Z'), '1 uur geleden');
  assert.equal(rel(post, '2026-10-10T12:59:59Z'), '2 uur geleden');
});
test('uren: 23 u nog uren, 24 u schakelt naar kalenderdag', () => {
  const post = '2026-10-09T08:00:00Z';
  assert.equal(rel(post, '2026-10-10T07:59:59Z'), '23 uur geleden');
  assert.equal(rel(post, '2026-10-10T08:00:00Z'), 'Gisteren');
});
test('kalenderdag-overgang rond middernacht (Amsterdam)', () => {
  // 23:50 lokaal -> 00:10 lokaal: pas 20 minuten, dus nog minuten
  assert.equal(rel('2026-10-09T21:50:00Z', '2026-10-09T22:10:00Z'), '20 minuten geleden');
  // 23:00 lokaal gisteren, nu 23:30 lokaal: 24,5 u => Gisteren
  assert.equal(rel('2026-10-09T21:00:00Z', '2026-10-10T21:30:00Z'), 'Gisteren');
  // 00:05 lokaal op 8 okt, nu 23:59 lokaal op 9 okt: bijna 48 u maar kalenderverschil 1
  assert.equal(rel('2026-10-07T22:05:00Z', '2026-10-09T21:59:00Z'), 'Gisteren');
  // UTC zou hier 2 dagen verschil geven, Amsterdam 1
  assert.equal(rel('2026-10-09T22:30:00Z', '2026-10-11T21:30:00Z'), 'Gisteren');
  // 23:59 lokaal op 8 okt: tot 23:59 op 9 okt is het "Gisteren", vanaf 00:00 op 10 okt "2 dagen geleden"
  assert.equal(rel('2026-10-08T21:59:00Z', '2026-10-09T21:59:00Z'), 'Gisteren');
  assert.equal(rel('2026-10-08T21:59:00Z', '2026-10-09T22:00:00Z'), '2 dagen geleden');
});
test('2-6 dagen: "N dagen geleden"; >= 7 dagen: datum', () => {
  const now = '2026-10-10T12:00:00Z';
  assert.equal(rel('2026-10-08T12:00:00Z', now), '2 dagen geleden');
  assert.equal(rel('2026-10-04T12:00:00Z', now), '6 dagen geleden');
  assert.equal(rel('2026-10-03T12:00:00Z', now), '3 oktober');
  assert.equal(rel('2026-01-15T12:00:00Z', now), '15 januari');
  assert.equal(rel('2025-12-31T12:00:00Z', now), '31 december 2025');
  assert.equal(rel('2026-10-02T23:30:00Z', now), '3 oktober'); // 01:30 lokaal op 3 okt
});
test('DST: kalenderdagen blijven kloppen over de overgang', () => {
  assert.equal(rel('2026-10-24T12:00:00Z', '2026-10-25T12:00:00Z'), 'Gisteren');
  assert.equal(rel('2026-10-24T22:30:00Z', '2026-10-25T23:30:00Z'), 'Gisteren'); // 00:30 CEST -> 00:30 CET: 25 u
  assert.equal(rel('2026-10-24T22:30:00Z', '2026-10-25T22:29:00Z'), '23 uur geleden');
  assert.equal(rel('2026-03-28T12:00:00Z', '2026-03-29T12:00:00Z'), 'Gisteren');
});
test('ongeldige invoer geeft lege tekst', () => {
  assert.equal(client.formatRelativeTime(NaN, Date.now()), '');
  assert.equal(client.parseInstagramTimestamp(''), NaN);
});
test('Instagram-timestamp met +0000 wordt correct geparsed', () => {
  assert.equal(client.parseInstagramTimestamp('2026-10-08T12:34:56+0000'), Date.UTC(2026, 9, 8, 12, 34, 56));
  assert.equal(client.parseInstagramTimestamp('2026-10-08T14:34:56+0200'), Date.UTC(2026, 9, 8, 12, 34, 56));
  assert.equal(client.parseInstagramTimestamp('2026-10-08T12:34:56.000Z'), Date.UTC(2026, 9, 8, 12, 34, 56));
});

console.log('Client: overig');
test('volgersaantal in nl-NL', () => {
  assert.equal(client.formatFollowers(12345), '12.345');
  assert.equal(client.formatFollowers(999), '999');
  assert.equal(client.formatFollowers(1234567), '1.234.567');
  assert.equal(client.formatFollowers(null), '');
});
test('poll-backoff: interval, exponentieel, plafond 5 min', () => {
  const f = n => client.nextPollDelay(n, 300000, 300000, 15000);
  assert.equal(f(0), 300000);
  assert.equal(f(1), 15000); assert.equal(f(2), 30000); assert.equal(f(3), 60000);
  assert.equal(f(4), 120000); assert.equal(f(5), 240000); assert.equal(f(6), 300000);
  assert.equal(f(50), 300000);
});
test('dagelijkse reload: alleen om 04:xx en niet direct na een verse start', () => {
  const p = (hour, minute) => ({ hour, minute });
  assert.equal(client.shouldReloadNow(p(4, 0), 3 * 3600000, 4, 1800000), true);
  assert.equal(client.shouldReloadNow(p(4, 0), 10000, 4, 1800000), false);
  assert.equal(client.shouldReloadNow(p(3, 59), 3 * 3600000, 4, 1800000), false);
  assert.equal(client.shouldReloadNow(p(5, 0), 3 * 3600000, 4, 1800000), false);
});

console.log('Ontwerp-controles op Index.html');
test('kleurcontrast >= 7:1 voor alle tekstkleuren op alle achtergronden', () => {
  const vars = {};
  html.replace(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g, (m, k, v) => { vars[k] = v; });
  const lum = hex => {
    const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  ['text', 'text-muted', 'accent-blue'].forEach(fg => ['bg', 'bg-2', 'panel'].forEach(bg => {
    const r = ratio(vars[fg], vars[bg]);
    console.log('       ' + fg + ' ' + vars[fg] + ' op ' + bg + ' ' + vars[bg] + ': ' + r.toFixed(2) + ':1');
    assert.ok(r >= 7, fg + ' op ' + bg + ' = ' + r.toFixed(2));
  }));
});
test('geen tekst kleiner dan 32 px; volgers >= 220 px; caption >= 40 px', () => {
  const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  const sizes = [...css.matchAll(/font-size:\s*(\d+)px/g)].map(m => +m[1]);
  assert.ok(sizes.length > 5);
  assert.ok(Math.min(...sizes) >= 32, 'kleinste: ' + Math.min(...sizes));
  assert.match(css, /#followers\s*\{[^}]*font-size:\s*220px/);
  assert.match(css, /#caption\s*\{[^}]*font-size:\s*40px/);
});
test('geen externe bronnen, geen scriptlet-tekens, geen setInterval', () => {
  assert.ok(!/<\?/.test(html), 'bevat <? (HtmlService-scriptlet)');
  assert.ok(!/(src|href)\s*=\s*["']https?:/i.test(html));
  assert.ok(!/url\(\s*["']?https?:/i.test(html));
  assert.ok(!/@import|fonts\.googleapis/i.test(html));
  assert.ok(!/setInterval/.test(html));
  assert.ok(/cursor:\s*none/.test(html) && /user-select:\s*none/.test(html));
});
test('client roept geen Meta-API aan', () => {
  assert.ok(!/graph\.(instagram|facebook)\.com/.test(html));
  assert.ok(!/fetch\(|XMLHttpRequest/.test(html));
});
test('appsscript.json: tijdzone, runtime, webapp, scopes', () => {
  const m = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'appsscript.json'), 'utf8'));
  assert.equal(m.timeZone, 'Europe/Amsterdam');
  assert.equal(m.runtimeVersion, 'V8');
  assert.equal(m.webapp.executeAs, 'USER_DEPLOYING');
  assert.equal(m.oauthScopes.length, 4);
});

console.log('\n' + passed + ' geslaagd, ' + failures.length + ' mislukt');
if (failures.length) { console.log('Mislukt: ' + failures.join('; ')); process.exit(1); }
