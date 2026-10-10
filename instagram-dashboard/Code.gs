/**
 * Narrowcasting-dashboard: Instagram @politie_eenheid_noordholland
 *
 * Opzet:
 *  - Een time-driven trigger (syncTick) haalt de data op en bewaart die.
 *  - De client roept NOOIT zelf de Meta API aan: getDashboardData() leest
 *    alleen uit CacheService en PropertiesService (en het afbeeldingsbestand in Drive).
 *  - Pure functies staan bovenaan, los van GAS-services, zodat Node ze kan testen.
 */

// ---------------------------------------------------------------------------
// Constanten
// ---------------------------------------------------------------------------
var TZ = 'Europe/Amsterdam';
var WINDOW_START_HOUR = 7;            // 07:00 <= t
var WINDOW_END_HOUR = 22;             // t < 22:00
var MIN_SYNC_INTERVAL_MIN = 25;       // triggers lopen bij benadering; nooit dubbel vuren
var CAPTION_MAX_CHARS = 600;          // Properties: max 9 KB per waarde
var CACHE_TTL_SECONDS = 21600;        // 6 uur
var CACHE_META_KEY = 'dashboard:meta';
var CACHE_IMAGE_PREFIX = 'dashboard:img:';
var IMAGE_CHUNK_CHARS = 90000;        // CacheService: waarde < 100 KB
var IMAGE_CACHE_MAX_CHARS = 2700000;  // grotere afbeeldingen komen altijd uit Drive
var MAX_IMAGE_BYTES = 8 * 1024 * 1024;
var TOKEN_REFRESH_AFTER_DAYS = 40;
var TOKEN_ALERT_AFTER_DAYS = 50;
var FAILURES_BEFORE_ALERT = 3;
var RETRY_DELAY_MS = 2000;
var DRIVE_FOLDER_NAME = 'Narrowcasting Instagram Dashboard';
var PLACEHOLDER_PREFIX = 'PLAK_HIER';
var INSTAGRAM_HOST = 'https://graph.instagram.com';
var FACEBOOK_HOST = 'https://graph.facebook.com';
var DISPLAY_NAME = 'Politie Eenheid Noord-Holland';
var DEFAULT_USERNAME = 'politie_eenheid_noordholland';
var RATE_LIMIT_CODES = [4, 17, 32, 613];
var TRANSIENT_API_CODES = [1, 2];

// ---------------------------------------------------------------------------
// Pure functies (geen GAS-services; getest in tests/logic.test.js)
// ---------------------------------------------------------------------------

/** Lege waarde of een achtergebleven placeholder uit setupScriptProperties(). */
function isPlaceholder(value) {
  var v = String(value == null ? '' : value).trim();
  return v === '' || v.indexOf(PLACEHOLDER_PREFIX) === 0;
}

/** Venster 07:00 <= t < 22:00 op basis van uur en minuut in Europe/Amsterdam. */
function isWithinWindow(hour, minute) {
  var minutes = hour * 60 + minute;
  return minutes >= WINDOW_START_HOUR * 60 && minutes < WINDOW_END_HOUR * 60;
}

/**
 * Klok in Europe/Amsterdam. `formatter` is standaard Utilities.formatDate;
 * tests geven een Intl-variant mee.
 */
function getAmsterdamClock(now, formatter) {
  var format = formatter || Utilities.formatDate;
  var parts = String(format(now, TZ, 'HH:mm')).split(':');
  return { hour: parseInt(parts[0], 10), minute: parseInt(parts[1], 10) };
}

/** Datumsleutel (yyyy-MM-dd) in Europe/Amsterdam, o.a. voor de limiet van 1 alert per dag. */
function getAmsterdamDateKey(now, formatter) {
  var format = formatter || Utilities.formatDate;
  return String(format(now, TZ, 'yyyy-MM-dd'));
}

/** True als de vorige poging lang genoeg geleden is (of onbekend/in de toekomst). */
function shouldSync(nowMs, lastAttemptMs, minIntervalMin) {
  var minMs = (minIntervalMin == null ? MIN_SYNC_INTERVAL_MIN : minIntervalMin) * 60000;
  if (typeof lastAttemptMs !== 'number' || !isFinite(lastAttemptMs)) return true;
  if (lastAttemptMs > nowMs) return true;
  return nowMs - lastAttemptMs >= minMs;
}

/**
 * Kort een caption in op een woordgrens (nooit midden in een woord of emoji)
 * tot maximaal `maxChars` tekens inclusief de ellips.
 */
function truncateCaption(text, maxChars) {
  var max = maxChars || CAPTION_MAX_CHARS;
  var t = String(text == null ? '' : text).replace(/\r\n?/g, '\n').trim();
  if (t.length <= max) return t;
  var limit = max - 1;
  var candidate = t.slice(0, limit + 1);
  var cut = -1;
  for (var i = candidate.length - 1; i > 0; i--) {
    if (/\s/.test(candidate.charAt(i))) { cut = i; break; }
  }
  var head;
  if (cut > 0) {
    head = t.slice(0, cut);
  } else {
    head = t.slice(0, limit);
    var last = head.charCodeAt(head.length - 1);
    if (last >= 0xD800 && last <= 0xDBFF) head = head.slice(0, -1);
  }
  return head.replace(/\s+$/, '') + '…';
}

/** IMAGE en CAROUSEL_ALBUM: media_url; VIDEO: thumbnail_url. Ontbreekt de URL: null. */
function pickMediaUrl(media) {
  if (!media) return null;
  if (media.media_type === 'VIDEO') return media.thumbnail_url || null;
  return media.media_url || null;
}

/** Zet het ruwe API-antwoord om naar { ok, username, followers, post }. */
function parseApiResponse(json) {
  if (!json || typeof json.followers_count !== 'number') {
    return { ok: false, reason: 'Antwoord bevat geen followers_count.' };
  }
  var media = json.media && json.media.data && json.media.data.length ? json.media.data[0] : null;
  var post = null;
  if (media && media.id) {
    post = {
      id: String(media.id),
      caption: media.caption || '',
      mediaType: media.media_type || '',
      mediaUrl: pickMediaUrl(media),
      permalink: media.permalink || '',
      timestamp: media.timestamp || ''
    };
  }
  return { ok: true, username: json.username || null, followers: json.followers_count, post: post };
}

/**
 * Classificeert een mislukte call.
 * kind: token (190) | rate (4/17/32/613) | config (100) | transient (netwerk/5xx) | api | http
 */
function classifyError(httpCode, body) {
  var err = body && body.error ? body.error : null;
  var code = err && typeof err.code === 'number' ? err.code : null;
  var subcode = err && typeof err.error_subcode === 'number' ? err.error_subcode : null;
  var message = err && err.message ? String(err.message) : '';
  var kind;
  if (code === 190) kind = 'token';
  else if (code !== null && RATE_LIMIT_CODES.indexOf(code) !== -1) kind = 'rate';
  else if (code === 100) kind = 'config';
  else if (httpCode === 0 || httpCode >= 500 || (code !== null && TRANSIENT_API_CODES.indexOf(code) !== -1)) kind = 'transient';
  else if (err) kind = 'api';
  else kind = 'http';
  return { kind: kind, code: code, subcode: subcode, httpCode: httpCode, message: message, retryable: kind === 'transient' };
}

/** Controleert de configuratie; geeft een lijst Nederlandse problemen (leeg = ok). */
function validateConfig(cfg) {
  var problems = [];
  if (isPlaceholder(cfg.token)) problems.push('META_ACCESS_TOKEN is nog niet ingevuld.');
  if (isPlaceholder(cfg.igUserId)) problems.push('IG_USER_ID is leeg.');
  if (cfg.apiHost !== INSTAGRAM_HOST && cfg.apiHost !== FACEBOOK_HOST) {
    problems.push('API_HOST moet ' + INSTAGRAM_HOST + ' of ' + FACEBOOK_HOST + ' zijn.');
  }
  if (!/^v\d+\.\d+$/.test(String(cfg.graphVersion || ''))) problems.push('GRAPH_VERSION heeft een ongeldig formaat (verwacht bijv. v25.0).');
  if (cfg.apiHost === FACEBOOK_HOST && String(cfg.igUserId).toLowerCase() === 'me') {
    problems.push('IG_USER_ID "me" werkt niet op graph.facebook.com (Graph-fout 100/33). Gebruik daar het numerieke Instagram-account-ID.');
  }
  return problems;
}

function needsTokenRefresh(ageDays) { return typeof ageDays === 'number' && ageDays > TOKEN_REFRESH_AFTER_DAYS; }
function isTokenTooOld(ageDays) { return typeof ageDays === 'number' && ageDays > TOKEN_ALERT_AFTER_DAYS; }

function daysBetween(isoString, nowMs) {
  var t = Date.parse(isoString);
  if (!isFinite(t)) return null;
  return (nowMs - t) / 86400000;
}

/** Maximaal 1 alert per kalenderdag (Amsterdam). */
function shouldSendAlert(lastAlertDateKey, todayKey) { return lastAlertDateKey !== todayKey; }

function buildVersion(postId, fetchedAt) { return String(postId || 'geen-bericht') + '@' + fetchedAt; }

/** Haalt het token uit tekst zodat het nooit in logs of mails belandt. */
function sanitizeMessage(text, token) {
  var s = String(text == null ? '' : text);
  if (token) s = s.split(token).join('[token]');
  return s.length > 300 ? s.slice(0, 299) + '…' : s;
}

// ---------------------------------------------------------------------------
// Configuratie
// ---------------------------------------------------------------------------

function readConfig_(props) {
  var all = props.getProperties();
  return {
    token: all.META_ACCESS_TOKEN || '',
    igUserId: all.IG_USER_ID || 'me',
    apiHost: all.API_HOST || INSTAGRAM_HOST,
    graphVersion: all.GRAPH_VERSION || 'v25.0',
    alertEmail: all.ALERT_EMAIL || '',
    useMock: String(all.USE_MOCK || '').toLowerCase() === 'true',
    debugNowIso: all.DEBUG_NOW_ISO || '',
    imageStore: all.IMAGE_STORE === 'hotlink' ? 'hotlink' : 'drive'
  };
}

/** "Nu". DEBUG_NOW_ISO overschrijft dit uitsluitend voor tests. */
function getNow_(props) {
  var iso = props.getProperty('DEBUG_NOW_ISO');
  if (iso) {
    var t = Date.parse(iso);
    if (isFinite(t)) return new Date(t);
  }
  return new Date();
}

/** Eenmalig draaien in de editor. Overschrijft nooit een bestaande waarde. */
function setupScriptProperties() {
  var props = PropertiesService.getScriptProperties();
  var existing = props.getProperties();
  var defaults = {
    META_ACCESS_TOKEN: 'PLAK_HIER_JE_TOKEN',
    ALERT_EMAIL: 'PLAK_HIER_JE_EMAILADRES',
    IG_USER_ID: 'me',
    API_HOST: INSTAGRAM_HOST,
    GRAPH_VERSION: 'v25.0',
    USE_MOCK: 'true',
    IMAGE_STORE: 'drive'
  };
  var toSet = {};
  Object.keys(defaults).forEach(function (key) {
    if (!(key in existing)) toSet[key] = defaults[key];
  });
  props.setProperties(toSet, false);
  console.log('Script Properties aangemaakt: ' + (Object.keys(toSet).join(', ') || '(niets nieuw)') +
    '. Vul META_ACCESS_TOKEN en ALERT_EMAIL in via Projectinstellingen en zet USE_MOCK op false.');
}

// ---------------------------------------------------------------------------
// Web App
// ---------------------------------------------------------------------------

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Instagram Politie Eenheid Noord-Holland')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Aangeroepen door de client. Leest alleen cache/opslag, doet NOOIT een externe call
 * en gooit nooit een exception: er komt altijd een geldig object terug.
 */
function getDashboardData(knownVersion) {
  var serverNow = Date.now();
  try {
    var props = PropertiesService.getScriptProperties();
    var cfg = readConfig_(props);
    var now = getNow_(props);
    serverNow = now.getTime();
    var meta = cfg.useMock ? buildMockMeta_(now) : readMeta_(props);
    if (!meta) meta = emptyMeta_();
    if (knownVersion && knownVersion === meta.version) {
      return { unchanged: true, version: meta.version, serverNow: serverNow };
    }
    var out = JSON.parse(JSON.stringify(meta));
    out.serverNow = serverNow;
    out.imageDataUri = null;
    if (cfg.useMock) {
      out.imageDataUri = buildMockImage_();
    } else if (meta.hasImage && meta.imageStore === 'drive') {
      out.imageDataUri = readImageDataUri_(props, meta);
    }
    return out;
  } catch (e) {
    console.error('getDashboardData: ' + (e && e.message));
    var empty = emptyMeta_();
    empty.serverNow = serverNow;
    empty.imageDataUri = null;
    return empty;
  }
}

function emptyMeta_() {
  return {
    status: 'empty',
    version: 'empty',
    displayName: DISPLAY_NAME,
    username: DEFAULT_USERNAME,
    followers: null,
    post: null,
    hasImage: false,
    imageStore: null,
    imageKey: null,
    imageUrl: null,
    fetchedAt: null
  };
}

// ---------------------------------------------------------------------------
// Opslag: cache -> Properties
// ---------------------------------------------------------------------------

function readMeta_(props) {
  var cache = CacheService.getScriptCache();
  var cached = cache.get(CACHE_META_KEY);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { /* val terug op Properties */ }
  }
  var stored = props.getProperty('LAST_GOOD');
  if (!stored) return null;
  try {
    var meta = JSON.parse(stored);
    cache.put(CACHE_META_KEY, stored, CACHE_TTL_SECONDS);
    return meta;
  } catch (e) {
    return null;
  }
}

function writeMeta_(props, meta) {
  var json = JSON.stringify(meta);
  // Properties-waarde max 9 KB: caption zo nodig verder inkorten.
  var guard = 0;
  while (Utilities.newBlob(json).getBytes().length > 8500 && meta.post && meta.post.caption.length > 40 && guard < 6) {
    meta.post.caption = truncateCaption(meta.post.caption, Math.floor(meta.post.caption.length / 2));
    json = JSON.stringify(meta);
    guard++;
  }
  props.setProperty('LAST_GOOD', json);
  CacheService.getScriptCache().put(CACHE_META_KEY, json, CACHE_TTL_SECONDS);
}

function clearImageCache_(imageKey) {
  if (!imageKey) return;
  var cache = CacheService.getScriptCache();
  var countKey = CACHE_IMAGE_PREFIX + imageKey + ':n';
  var n = parseInt(cache.get(countKey), 10);
  var keys = [countKey];
  for (var i = 0; i < (isFinite(n) ? n : 0); i++) keys.push(CACHE_IMAGE_PREFIX + imageKey + ':' + i);
  cache.removeAll(keys);
}

function cacheImage_(imageKey, dataUri) {
  if (!imageKey || !dataUri || dataUri.length > IMAGE_CACHE_MAX_CHARS) return;
  var cache = CacheService.getScriptCache();
  var map = {};
  var n = Math.ceil(dataUri.length / IMAGE_CHUNK_CHARS);
  for (var i = 0; i < n; i++) {
    map[CACHE_IMAGE_PREFIX + imageKey + ':' + i] = dataUri.slice(i * IMAGE_CHUNK_CHARS, (i + 1) * IMAGE_CHUNK_CHARS);
  }
  map[CACHE_IMAGE_PREFIX + imageKey + ':n'] = String(n);
  cache.putAll(map, CACHE_TTL_SECONDS);
}

/** Afbeelding als data-URI: eerst uit cache (in stukken), anders uit Drive. Nooit een externe call. */
function readImageDataUri_(props, meta) {
  try {
    var cache = CacheService.getScriptCache();
    var n = parseInt(cache.get(CACHE_IMAGE_PREFIX + meta.imageKey + ':n'), 10);
    if (isFinite(n) && n > 0) {
      var keys = [];
      for (var i = 0; i < n; i++) keys.push(CACHE_IMAGE_PREFIX + meta.imageKey + ':' + i);
      var got = cache.getAll(keys);
      var parts = [];
      for (var j = 0; j < n; j++) {
        if (!got[keys[j]]) { parts = null; break; }
        parts.push(got[keys[j]]);
      }
      if (parts) return parts.join('');
    }
    var fileId = props.getProperty('IMAGE_FILE_ID');
    if (!fileId) return null;
    var blob = DriveApp.getFileById(fileId).getBlob();
    var uri = 'data:' + (meta.imageMime || blob.getContentType() || 'image/jpeg') + ';base64,' + Utilities.base64Encode(blob.getBytes());
    cacheImage_(meta.imageKey, uri);
    return uri;
  } catch (e) {
    console.error('readImageDataUri_: ' + (e && e.message));
    return null; // client behoudt dan de vorige afbeelding
  }
}

// ---------------------------------------------------------------------------
// Synchronisatie (trigger-handler)
// ---------------------------------------------------------------------------

function syncTick() {
  var props = PropertiesService.getScriptProperties();
  var clock = getAmsterdamClock(getNow_(props));
  if (!isWithinWindow(clock.hour, clock.minute)) return; // buiten het venster: geen calls
  runSync_(false);
}

/** Handmatig starten (bijv. na het invullen van het token): negeert venster en interval. */
function forceSync() {
  return runSync_(true);
}

function runSync_(force) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return 'lock bezet';
  try {
    var props = PropertiesService.getScriptProperties();
    var cfg = readConfig_(props);
    if (cfg.useMock) return 'USE_MOCK staat aan: geen fetch';
    var problems = validateConfig(cfg);
    if (problems.length) {
      recordFailure_(props, cfg, { kind: 'config', code: null, subcode: null, message: problems.join(' ') });
      return 'configuratie onvolledig';
    }
    var nowMs = Date.now();
    var lastAttempt = parseFloat(props.getProperty('LAST_ATTEMPT_MS'));
    if (!force && !shouldSync(nowMs, lastAttempt, MIN_SYNC_INTERVAL_MIN)) return 'te vroeg';
    props.setProperty('LAST_ATTEMPT_MS', String(nowMs));

    var result = fetchWithRetry_(cfg);
    if (!result.ok) {
      recordFailure_(props, cfg, result.error);
      return 'mislukt: ' + result.error.kind;
    }
    try {
      applySuccess_(props, cfg, result.parsed, nowMs);
    } catch (e) {
      recordFailure_(props, cfg, { kind: 'internal', code: null, subcode: null, message: 'Opslaan mislukt: ' + (e && e.message) });
      return 'opslaan mislukt';
    }
    return 'ok';
  } finally {
    lock.releaseLock();
  }
}

function buildApiUrl_(cfg) {
  var fields = 'followers_count,username,media.limit(1){id,caption,media_type,media_url,thumbnail_url,permalink,timestamp}';
  return cfg.apiHost + '/' + cfg.graphVersion + '/' + encodeURIComponent(cfg.igUserId) +
    '?fields=' + encodeURIComponent(fields) + '&access_token=' + encodeURIComponent(cfg.token);
}

function fetchOnce_(cfg) {
  var resp;
  try {
    resp = UrlFetchApp.fetch(buildApiUrl_(cfg), { method: 'get', muteHttpExceptions: true });
  } catch (e) {
    return { ok: false, error: { kind: 'transient', code: null, subcode: null, httpCode: 0, retryable: true,
      message: sanitizeMessage('Netwerkfout: ' + (e && e.message), cfg.token) } };
  }
  var httpCode = resp.getResponseCode();
  var body = null;
  try { body = JSON.parse(resp.getContentText()); } catch (e) { body = null; }
  if (httpCode === 200 && body && !body.error) {
    var parsed = parseApiResponse(body);
    if (parsed.ok) return { ok: true, parsed: parsed };
    return { ok: false, error: { kind: 'api', code: null, subcode: null, httpCode: httpCode, retryable: false, message: parsed.reason } };
  }
  var err = classifyError(httpCode, body);
  err.message = sanitizeMessage(err.message || ('HTTP ' + httpCode), cfg.token);
  return { ok: false, error: err };
}

/** Maximaal 1 retry na 2 s, alleen bij netwerkfout of 5xx. */
function fetchWithRetry_(cfg) {
  var result = fetchOnce_(cfg);
  if (!result.ok && result.error.retryable) {
    Utilities.sleep(RETRY_DELAY_MS);
    result = fetchOnce_(cfg);
  }
  return result;
}

function downloadImage_(url) {
  var resp = UrlFetchApp.fetch(url, { method: 'get', muteHttpExceptions: true, followRedirects: true });
  if (resp.getResponseCode() !== 200) throw new Error('Afbeelding: HTTP ' + resp.getResponseCode());
  var headers = resp.getHeaders();
  var mime = String(headers['Content-Type'] || headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (mime.indexOf('image/') !== 0) throw new Error('Afbeelding: onverwacht type ' + mime);
  var bytes = resp.getContent();
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error('Afbeelding te groot');
  return { bytes: bytes, mime: mime };
}

function getOrCreateFolder_(props) {
  var id = props.getProperty('DRIVE_FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* map verwijderd: opnieuw aanmaken */ }
  }
  var it = DriveApp.getFoldersByName(DRIVE_FOLDER_NAME);
  var folder = it.hasNext() ? it.next() : DriveApp.createFolder(DRIVE_FOLDER_NAME);
  props.setProperty('DRIVE_FOLDER_ID', folder.getId());
  return folder;
}

/** Bewaart de afbeelding in Drive en ruimt het vorige bestand pas op na succes. */
function storeImageInDrive_(props, postId, image) {
  var ext = image.mime === 'image/png' ? '.png' : image.mime === 'image/webp' ? '.webp' : '.jpg';
  var blob = Utilities.newBlob(image.bytes, image.mime, 'ig-' + postId + ext);
  var file = getOrCreateFolder_(props).createFile(blob);
  var oldId = props.getProperty('IMAGE_FILE_ID');
  props.setProperty('IMAGE_FILE_ID', file.getId());
  if (oldId && oldId !== file.getId()) {
    try { DriveApp.getFileById(oldId).setTrashed(true); } catch (e) { /* al weg */ }
  }
  return file.getId();
}

/**
 * Werkt cache en Properties bij na een geslaagde call.
 * Een nieuw bericht zonder bruikbare afbeelding vervangt het vorige bericht niet
 * (anders hoort de tekst niet bij het beeld); alleen het volgersaantal wordt dan bijgewerkt.
 */
function applySuccess_(props, cfg, parsed, nowMs) {
  var prev = null;
  try { prev = JSON.parse(props.getProperty('LAST_GOOD') || 'null'); } catch (e) { prev = null; }
  var fetchedAt = new Date(nowMs).toISOString();

  var meta = {
    status: 'ok',
    displayName: DISPLAY_NAME,
    username: parsed.username || (prev && prev.username) || DEFAULT_USERNAME,
    followers: parsed.followers,
    post: prev ? prev.post : null,
    hasImage: prev ? !!prev.hasImage : false,
    imageStore: prev ? prev.imageStore : null,
    imageMime: prev ? prev.imageMime : null,
    imageKey: prev ? prev.imageKey : null,
    imageUrl: prev ? prev.imageUrl : null,
    fetchedAt: fetchedAt
  };

  var p = parsed.post;
  var newImageDataUri = null;
  if (p) {
    var samePost = !!(prev && prev.post && prev.post.id === p.id);
    var haveImage = !!(prev && prev.hasImage && prev.imageKey === p.id && prev.imageStore === cfg.imageStore);
    var imageInfo = null;

    if (cfg.imageStore === 'hotlink') {
      if (p.mediaUrl) imageInfo = { imageStore: 'hotlink', imageUrl: p.mediaUrl, imageMime: null };
    } else if (!haveImage && p.mediaUrl) {
      try {
        var dl = downloadImage_(p.mediaUrl);
        storeImageInDrive_(props, p.id, dl);
        imageInfo = { imageStore: 'drive', imageUrl: null, imageMime: dl.mime };
        newImageDataUri = 'data:' + dl.mime + ';base64,' + Utilities.base64Encode(dl.bytes);
      } catch (e) {
        console.error('Afbeelding ophalen mislukt: ' + sanitizeMessage(e && e.message, cfg.token));
      }
    }

    var consistent = !!imageInfo || samePost || !prev || !prev.post;
    if (consistent) {
      var oldKey = prev ? prev.imageKey : null;
      meta.post = {
        id: p.id,
        caption: truncateCaption(p.caption, CAPTION_MAX_CHARS),
        mediaType: p.mediaType,
        permalink: p.permalink,
        timestamp: p.timestamp
      };
      if (imageInfo) {
        meta.hasImage = true;
        meta.imageStore = imageInfo.imageStore;
        meta.imageMime = imageInfo.imageMime;
        meta.imageUrl = imageInfo.imageUrl;
        meta.imageKey = p.id;
        if (oldKey && oldKey !== p.id) clearImageCache_(oldKey);
      } else if (!samePost) {
        // eerste bericht ooit, zonder afbeelding: tekst zonder beeld tonen
        meta.hasImage = false;
        meta.imageStore = null;
        meta.imageKey = null;
        meta.imageUrl = null;
      }
    }
  }

  meta.version = buildVersion(meta.post ? meta.post.id : null, fetchedAt);
  writeMeta_(props, meta);
  if (newImageDataUri) cacheImage_(meta.imageKey, newImageDataUri);

  props.setProperties({ CONSECUTIVE_FAILURES: '0', LAST_SUCCESS_AT: fetchedAt }, false);
  props.deleteProperty('LAST_ERROR');
}

// ---------------------------------------------------------------------------
// Fouten en alerts
// ---------------------------------------------------------------------------

function recordFailure_(props, cfg, err) {
  var failures = (parseInt(props.getProperty('CONSECUTIVE_FAILURES'), 10) || 0) + 1;
  var record = {
    kind: err.kind, code: err.code == null ? null : err.code, subcode: err.subcode == null ? null : err.subcode,
    message: sanitizeMessage(err.message, cfg.token), at: new Date().toISOString()
  };
  props.setProperties({ CONSECUTIVE_FAILURES: String(failures), LAST_ERROR: JSON.stringify(record) }, false);
  console.error('Sync mislukt (' + failures + 'x): ' + JSON.stringify(record));

  var reason = null;
  if (err.kind === 'token') reason = 'Het toegangstoken is ongeldig of verlopen (Meta-fout 190). Genereer een nieuw token.';
  else if (err.kind === 'config' && !isPlaceholder(cfg.token)) {
    reason = 'De aanvraag wordt door Meta geweigerd (fout 100' + (record.subcode ? '/' + record.subcode : '') +
      '): controleer IG_USER_ID, API_HOST en de rechten van het token.';
  } else if (failures >= FAILURES_BEFORE_ALERT) reason = failures + ' opeenvolgende mislukte synchronisaties.';
  if (reason) sendAlert_(props, cfg, 'Instagram-dashboard: actie nodig', reason + '\n\nLaatste fout: ' + JSON.stringify(record));
}

/** Maximaal 1 mail per dag. Zonder geldig ALERT_EMAIL gebeurt er niets. */
function sendAlert_(props, cfg, subject, body) {
  var to = String(cfg.alertEmail || '').trim();
  if (isPlaceholder(to) || to.indexOf('@') === -1) return false;
  var today = getAmsterdamDateKey(new Date());
  if (!shouldSendAlert(props.getProperty('LAST_ALERT_DATE'), today)) return false;
  try {
    MailApp.sendEmail(to, subject, body + '\n\nHet dashboard blijft intussen de laatst bekende gegevens tonen.');
    props.setProperty('LAST_ALERT_DATE', today);
    return true;
  } catch (e) {
    console.error('Alert versturen mislukt: ' + (e && e.message));
    return false;
  }
}

// ---------------------------------------------------------------------------
// Token verversen (alleen graph.instagram.com)
// ---------------------------------------------------------------------------

function refreshTokenIfNeeded() {
  var props = PropertiesService.getScriptProperties();
  var cfg = readConfig_(props);
  if (cfg.useMock) return 'mock';
  if (cfg.apiHost !== INSTAGRAM_HOST) {
    console.log('Token verversen overgeslagen: alleen van toepassing op graph.instagram.com.');
    return 'no-op';
  }
  if (isPlaceholder(cfg.token)) return 'geen token';
  var clock = getAmsterdamClock(getNow_(props));
  if (!isWithinWindow(clock.hour, clock.minute)) return 'buiten venster';

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return 'lock bezet';
  try {
    var nowMs = Date.now();
    var refreshedAt = props.getProperty('TOKEN_REFRESHED_AT');
    if (!refreshedAt) { // onbekende leeftijd: begin te tellen vanaf nu
      props.setProperty('TOKEN_REFRESHED_AT', new Date(nowMs).toISOString());
      return 'leeftijd onbekend: teller gestart';
    }
    var age = daysBetween(refreshedAt, nowMs);
    if (!needsTokenRefresh(age)) return 'nog geldig';

    var url = INSTAGRAM_HOST + '/refresh_access_token?grant_type=ig_refresh_token&access_token=' + encodeURIComponent(cfg.token);
    var ok = false;
    var detail = '';
    try {
      var resp = UrlFetchApp.fetch(url, { method: 'get', muteHttpExceptions: true });
      var body = null;
      try { body = JSON.parse(resp.getContentText()); } catch (e) { body = null; }
      if (resp.getResponseCode() === 200 && body && body.access_token) {
        props.setProperties({ META_ACCESS_TOKEN: body.access_token, TOKEN_REFRESHED_AT: new Date(nowMs).toISOString() }, false);
        props.deleteProperty('LAST_REFRESH_ERROR');
        ok = true;
      } else {
        var err = classifyError(resp.getResponseCode(), body);
        detail = 'kind=' + err.kind + ' code=' + err.code + ' ' + sanitizeMessage(err.message, cfg.token);
      }
    } catch (e) {
      detail = sanitizeMessage('Netwerkfout: ' + (e && e.message), cfg.token);
    }
    if (!ok) {
      props.setProperty('LAST_REFRESH_ERROR', detail);
      console.error('Token verversen mislukt: ' + detail);
      if (isTokenTooOld(age)) {
        sendAlert_(props, cfg, 'Instagram-dashboard: token verloopt binnenkort',
          'Het token is ' + Math.floor(age) + ' dagen oud en kon niet worden vernieuwd (' + detail + '). ' +
          'Genereer binnen enkele dagen handmatig een nieuw token.');
      }
    }
    return ok ? 'ververst' : 'mislukt';
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

/** Idempotent: verwijdert eerst eigen oude triggers en maakt ze opnieuw aan. */
function installTriggers() {
  var own = ['syncTick', 'refreshTokenIfNeeded'];
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (own.indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncTick').timeBased().everyMinutes(30).create();
  ScriptApp.newTrigger('refreshTokenIfNeeded').timeBased().everyDays(1).atHour(10).create();
  console.log('Triggers geinstalleerd: syncTick (30 min) en refreshTokenIfNeeded (dagelijks rond 10:00).');
}

/** Hulpfunctie voor de editor: toont de status zonder geheimen. */
function logStatus() {
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties();
  var meta = null;
  try { meta = JSON.parse(all.LAST_GOOD || 'null'); } catch (e) { meta = null; }
  console.log(JSON.stringify({
    lastSuccessAt: all.LAST_SUCCESS_AT || null,
    consecutiveFailures: all.CONSECUTIVE_FAILURES || '0',
    lastError: all.LAST_ERROR ? JSON.parse(all.LAST_ERROR) : null,
    tokenRefreshedAt: all.TOKEN_REFRESHED_AT || null,
    lastAlertDate: all.LAST_ALERT_DATE || null,
    followers: meta ? meta.followers : null,
    postId: meta && meta.post ? meta.post.id : null,
    version: meta ? meta.version : null
  }, null, 2));
}

// ---------------------------------------------------------------------------
// Mock (USE_MOCK=true): geen netwerk
// ---------------------------------------------------------------------------

function buildMockMeta_(now) {
  var nowMs = now.getTime();
  var bucket = Math.floor(nowMs / 3600000);
  return {
    status: 'ok',
    version: 'mock@' + bucket,
    displayName: DISPLAY_NAME,
    username: DEFAULT_USERNAME,
    followers: 12345,
    post: {
      id: 'mock-' + bucket,
      caption: 'Controle op fietsverlichting in de Haarlemse binnenstad. Onze agenten spraken vanmiddag met tientallen fietsers. ' +
        'Wie zonder licht reed, kreeg uitleg en een waarschuwing.\n\nZo zien we elkaar op tijd in het donker! ' +
        'Meer tips: https://www.politie.nl\n.\n.\n#verlichting #fiets #Haarlem #NoordHolland',
      mediaType: 'IMAGE',
      permalink: 'https://www.instagram.com/',
      timestamp: new Date(nowMs - (2 * 3600 + 45 * 60) * 1000).toISOString()
    },
    hasImage: true,
    imageStore: 'drive',
    imageKey: 'mock-' + bucket,
    imageUrl: null,
    fetchedAt: new Date(nowMs).toISOString()
  };
}

function buildMockImage_() {
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350">' +
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1c3f7a"/><stop offset="1" stop-color="#0a1a3a"/></linearGradient></defs>' +
    '<rect width="1080" height="1350" fill="url(#g)"/>' +
    '<circle cx="540" cy="560" r="260" fill="none" stroke="#f2e500" stroke-width="28"/>' +
    '<rect x="140" y="940" width="800" height="36" rx="18" fill="#ffffff" opacity="0.85"/>' +
    '<rect x="240" y="1020" width="600" height="36" rx="18" fill="#ffffff" opacity="0.5"/>' +
    '<text x="540" y="1230" font-family="Arial, sans-serif" font-size="56" fill="#ffffff" text-anchor="middle">Voorbeeldafbeelding</text>' +
    '</svg>';
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

// ---------------------------------------------------------------------------
// Export voor Node-tests (genegeerd in Apps Script)
// ---------------------------------------------------------------------------
if (typeof module !== 'undefined') {
  module.exports = {
    isPlaceholder: isPlaceholder,
    isWithinWindow: isWithinWindow,
    getAmsterdamClock: getAmsterdamClock,
    getAmsterdamDateKey: getAmsterdamDateKey,
    shouldSync: shouldSync,
    truncateCaption: truncateCaption,
    pickMediaUrl: pickMediaUrl,
    parseApiResponse: parseApiResponse,
    classifyError: classifyError,
    validateConfig: validateConfig,
    needsTokenRefresh: needsTokenRefresh,
    isTokenTooOld: isTokenTooOld,
    daysBetween: daysBetween,
    shouldSendAlert: shouldSendAlert,
    buildVersion: buildVersion,
    sanitizeMessage: sanitizeMessage,
    buildApiUrl_: buildApiUrl_
  };
}
