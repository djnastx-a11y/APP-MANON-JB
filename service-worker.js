const CACHE="nous-deux-v1";
const ASSETS=["./","./index.html","./app.css","./app.js","./manifest.json","./config.js"];
self.addEventListener("install",e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS))));
self.addEventListener("fetch",e=>e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request))));
