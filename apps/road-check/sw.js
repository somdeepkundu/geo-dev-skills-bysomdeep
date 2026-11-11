/* Road Check service worker: the app opens and runs with no network, so a reload mid-ride cannot strand you.
   - CORE files are cached on install; if one cannot be fetched the install fails (so a half-copy is never used).
   - OPTIONAL files (icons) are cached if they can be, and ignored if not.
   - Pages: network first with a 4 s timeout, then the cached copy. Files: cache first.
   - Map tiles seen or saved while online are kept as real (non-opaque) responses, up to TILE_MAX, oldest dropped first.
   - Answers {type:'status'} from the page with what is cached and what is missing.
   Keep VERSION equal to APP.version in app.js and bump it with every change. */
const VERSION = 'road-check-0.2.0';
const TILE_CACHE = 'road-check-tiles-2';       // new name: tiles cached by 0.1.x as opaque responses are dropped on activate
const TILE_MAX = 2500;
const CORE = [
  './', './index.html', './app.js', './road-core.js', './ride-store.js', './style.css', './manifest.json', './icon.svg',
  './lib/sensor-core.js', './lib/field-store.js',
  './vendor/leaflet/leaflet.js', './vendor/leaflet/leaflet.css', './vendor/jszip.min.js', './vendor/fonts/fonts.css',
  './vendor/fonts/atkinson-hyperlegible-latin-400-normal.woff2', './vendor/fonts/atkinson-hyperlegible-latin-700-normal.woff2'
];
const OPTIONAL = [
  './icons/icon-192.png', './icons/icon-512.png',
  './vendor/fonts/atkinson-hyperlegible-latin-ext-400-normal.woff2', './vendor/fonts/atkinson-hyperlegible-latin-ext-700-normal.woff2'
];
const TILE_HOSTS = /(^|\.)tile\.openstreetmap\.org$/;

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await Promise.all(CORE.map(u => c.add(new Request(u, { cache: 'reload' }))));          // any failure rejects: no install
    await Promise.all(OPTIONAL.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION && k !== TILE_CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('message', e => {
  if (!e.data || e.data.type !== 'status' || !e.source) return;
  (async () => {
    const c = await caches.open(VERSION), missing = [];
    for (const u of CORE) if (!(await c.match(u))) missing.push(u);
    const tiles = (await (await caches.open(TILE_CACHE)).keys()).length;
    e.source.postMessage({ type: 'status', version: VERSION, core: CORE.length, missing, tiles });
  })();
});

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
async function networkFirst(req) {
  const cache = await caches.open(VERSION);
  try { const res = await withTimeout(fetch(req), 4000); if (res && res.ok) cache.put(req, res.clone()); return res; }
  catch (e) { return (await cache.match(req, { ignoreSearch: true })) || (await cache.match('./index.html')) || Response.error(); }
}
async function cacheFirst(req) {
  const hit = await caches.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res && res.ok) { const c = await caches.open(VERSION); c.put(req, res.clone()); }
  return res;
}
let trimming = false;
async function trimTiles() {
  if (trimming) return; trimming = true;
  try { const c = await caches.open(TILE_CACHE), keys = await c.keys(); for (let i = 0; i < keys.length - TILE_MAX; i++) await c.delete(keys[i]); }
  finally { trimming = false; }
}
/* Tiles are fetched with CORS (OpenStreetMap allows it) so the cached copy is a normal response of its real size.
   An opaque (no-cors) response is never cached: browsers count each one as several MB against the storage quota,
   which would starve the ride database. If CORS fails the tile is shown but not kept. */
async function tile(req) {
  const c = await caches.open(TILE_CACHE), hit = await c.match(req.url);
  if (hit) return hit;
  try {
    const res = await fetch(req.url, { mode: 'cors', credentials: 'omit' });
    if (res.ok && res.type !== 'opaque') c.put(req.url, res.clone()).then(trimTiles).catch(() => {});
    return res;
  } catch (e) {
    try { return await fetch(req); } catch (e2) { return Response.error(); }
  }
}
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (TILE_HOSTS.test(url.hostname)) { e.respondWith(tile(req)); return; }
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname.endsWith('/')) e.respondWith(networkFirst(req));
  else e.respondWith(cacheFirst(req));
});
