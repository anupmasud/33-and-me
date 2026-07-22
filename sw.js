/* 33&Me service worker — caches the app shell so the app opens
   (and search over the last sync works) inside a record store
   with no signal. API calls are never cached here; data caching
   is handled in localStorage by app.js. */
const CACHE = "me33-shell-v43";
const SHELL = [
  ".", "index.html", "styles.css", "app.js", "config.js",
  "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // never intercept Google APIs / auth
  if (url.origin !== location.origin) return;
  if (e.request.method !== "GET") return;
  // Stale-while-revalidate: serve cache instantly (fast paint), refresh in the
  // background so the next load has the newest files. A version bump to CACHE
  // still force-purges everything via the activate handler.
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fromNetwork = fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
          return res;
        })
        .catch(() => cached || caches.match("index.html"));
      return cached || fromNetwork;
    })
  );
});
