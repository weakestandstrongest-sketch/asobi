// オフラインでも遊べるようにするためのキャッシュ。
// ファイルを更新したら VERSION を上げる。
const VERSION = 'asobi-v3';
const FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'icons/icon.svg',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'js/app.js',
  'js/ui.js',
  'js/art.js',
  'js/games/airhockey.js',
  'js/games/chess.js',
  'js/games/chess-pieces.js',
  'js/games/chess-logic.js',
  'js/games/gomoku.js',
  'js/games/gomoku-logic.js',
  'js/games/hitblow.js',
  'js/games/hitblow-logic.js',
  'js/games/minishogi.js',
  'js/games/minishogi-logic.js',
  'js/games/reversi.js',
  'js/games/reversi-logic.js',
  'js/games/yacht.js',
  'js/games/yacht-logic.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// ネットワーク優先、つながらなければキャッシュ
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== location.origin) return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((cache) => cache.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true })),
  );
});
