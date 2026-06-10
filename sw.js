// sw.js — offline support + faster loads for ŞahAnaliz (PWA).
// Strategy:
//   - app code (html/js/css)  -> network-first (fresh on every deploy), cache fallback
//   - big immutable binaries   -> cache-first (instant, offline): engine + openings
//   - cross-origin (fonts)     -> stale-while-revalidate
// Bump VERSION to force a full refresh of the precache.
const VERSION = 'sahanaliz-v1';

const CORE = [
  './', './index.html', './styles.css', './app.js',
  './analysis.js', './engine.js', './chesscom.js', './pieces.js',
  './i18n.js', './openings-info.js', './share.js',
  './chess.js', './openings.js', './stockfish.js', './stockfish.wasm',
  './manifest.webmanifest', './icon-192.png', './icon-512.png',
];

// Files that essentially never change -> serve from cache first.
const IMMUTABLE = ['stockfish.js', 'stockfish.wasm', 'openings.js', 'chess.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => c.addAll(CORE))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isImmutable(url) {
  return IMMUTABLE.some((n) => url.pathname.endsWith('/' + n) || url.pathname.endsWith(n));
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (_) { return; }

  // cross-origin (e.g. Google Fonts) -> stale-while-revalidate
  if (url.origin !== self.location.origin) {
    e.respondWith(
      caches.open(VERSION).then((c) => c.match(req).then((hit) => {
        const net = fetch(req).then((res) => {
          if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone());
          return res;
        }).catch(() => hit);
        return hit || net;
      }))
    );
    return;
  }

  // big immutable assets -> cache-first
  if (isImmutable(url)) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy));
        return res;
      }))
    );
    return;
  }

  // navigations + app code -> network-first (stay fresh), fallback to cache
  e.respondWith(
    fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(req, copy));
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
  );
});
