const CACHE = 'pecsoteka-0.2.0-preview.1';
const APP_VERSION = '0.2.0-preview.1';
const CORE = ['./', './index.html', './styles.css', './app.js', './domain.js', './storage.js', './services.js', './drag.js', './pwa.js', './config.js', './audio.js', './recording-editor.js', './updates.json', './manifest.webmanifest', './assets/brand.svg', './assets/icon-192.png', './assets/icon-512.png', './assets/icon-maskable.png'];
const ICONS = ['want','help','more','stop','yes','no','pause','toilet','water','apple','banana','bread','soup','milk','cookie','juice','play','book','walk','sleep','draw','music','wash','eat','mom','dad','me','home','park','school','happy','sad','hurt','hot','cold','tired'];
const FILES = [...CORE, ...ICONS.map(id => `./assets/cards/${id}.svg`)];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES))); });
self.addEventListener('message', event => {
  if (event.data === 'ACTIVATE') self.skipWaiting();
  if (event.data?.type === 'GET_VERSION' && event.ports[0]) event.waitUntil((async () => {
    let releases = [];
    try { const response = await (await caches.open(CACHE)).match('./updates.json'); releases = (await response.json()).releases; } catch {}
    event.ports[0].postMessage({ version: CACHE, appVersion: APP_VERSION, releases });
  })());
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
    // Static hosts may redirect index.html to ./; navigation rejects a cached
    // redirected response, so use the canonical directory response first.
    if (event.request.mode === 'navigate') return await cache.match('./') || await cache.match('./index.html') || fetch(event.request);
    return await cache.match(event.request) || fetch(event.request);
  }));
});
