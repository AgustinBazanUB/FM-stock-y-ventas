const CACHE = "flor-mia-shell-v13";
const SHELL = [
  "/", "/index.html", "/styles.css", "/firebase-config.js", "/app.js",
  "/auth.js", "/admin.js", "/seller.js", "/keyboard.js", "/utils.js", "/discounts.js", "/image-catalog.js",
  "/firebase-service.js", "/offline-sales.js", "/manifest.webmanifest", "/assets/icons/icon.svg", "/assets/img/placeholder-producto.png", "/assets/products/catalog.json",
  "/assets/products/botella-500cc-blend.webp", "/assets/products/botella-500cc-blend-thumb.webp"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(async cache => {
    await cache.addAll(SHELL);
    try {
      const response = await fetch("/assets/products/catalog.json");
      const catalog = await response.json();
      const productAssets = [...new Set(catalog.flatMap(item => [item.imageUrl, item.thumbUrl]).filter(Boolean))];
      await cache.addAll(productAssets);
    } catch (_) { /* El catálogo base ya quedó en caché; las imágenes se pedirán al usarlas. */ }
  }).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET" || !request.url.startsWith(self.location.origin)) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then(response => {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put("/index.html", copy));
      return response;
    }).catch(() => caches.match("/index.html")));
    return;
  }
  event.respondWith(fetch(request).then(response => {
    if (response.ok) caches.open(CACHE).then(cache => cache.put(request, response.clone()));
    return response;
  }).catch(() => caches.match(request).then(response => response || (request.destination === "image" ? caches.match(request, {ignoreSearch:true}) : undefined))));
});
