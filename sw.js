/* Service worker — Messes à proximité (PWA)
   - précache la « coquille » de l'app pour un fonctionnement hors-ligne ;
   - Leaflet (CDN) en stale-while-revalidate ;
   - tuiles / API / proxys : réseau, avec repli sur le cache si présent. */

const VERSION = "v1";
const CACHE = `messes-pwa-${VERSION}`;

const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function putInCache(request, response) {
  const copy = response.clone();
  caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  let url;
  try { url = new URL(request.url); } catch (e) { return; }

  // Navigations : réseau d'abord, repli sur la page en cache (hors-ligne)
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("./index.html").then((r) => r || caches.match("./")))
    );
    return;
  }

  // Même origine (coquille, icônes) : cache d'abord
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((res) => {
        if (res && res.ok) putInCache(request, res);
        return res;
      }))
    );
    return;
  }

  // Leaflet (CDN) : stale-while-revalidate pour disposer de la carte hors-ligne
  if (url.hostname === "unpkg.com") {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request).then((res) => {
          if (res && (res.ok || res.type === "opaque")) putInCache(request, res);
          return res;
        }).catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // Autres domaines (tuiles, messes.info, proxys, Base Adresse Nationale) :
  // réseau prioritaire, repli sur le cache si une réponse existe.
  event.respondWith(fetch(request).catch(() => caches.match(request)));
});
