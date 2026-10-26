const CACHE = 'pecsoteka-0.1.1';
const CORE = ['./', './index.html', './styles.css', './app.js', './domain.js', './storage.js', './services.js', './drag.js', './pwa.js', './manifest.webmanifest', './assets/brand.svg', './assets/icon-192.png', './assets/icon-512.png', './assets/icon-maskable.png'];
const ICONS = ['want','help','more','stop','yes','no','pause','toilet','water','apple','banana','bread','soup','milk','cookie','juice','play','book','walk','sleep','draw','music','wash','eat','mom','dad','me','home','park','school','happy','sad','hurt','hot','cold','tired'];
const FILES = [...CORE, ...ICONS.map(id => `./assets/cards/${id}.svg`)];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES))); });
self.addEventListener('message', event => {
  if (event.data === 'ACTIVATE') self.skipWaiting();
  if (event.data?.type === 'GET_VERSION') event.ports[0]?.postMessage({ version: CACHE });
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('pecsoteka-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin || !url.href.startsWith(self.registration.scope)) return;
  // Once installed, the whole shell comes from one immutable cache version.
  // Updating is explicit so a new HTML shell cannot load old JS modules mid-session.
  event.respondWith(caches.open(CACHE).then(async cache => {
    if (event.request.mode === 'navigate') return await cache.match('./index.html') || fetch(event.request);
    return await cache.match(event.request) || fetch(event.request);
  }));
});
