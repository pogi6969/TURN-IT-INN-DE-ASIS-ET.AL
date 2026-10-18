/* Turn In Out service worker: keeps the website, the app, the engines, the fonts and the icons so the
   app opens and builds reports without a connection. Pages come from the network when online.
   Bump VERSION after changing any file. */
var VERSION = "tio-v2";
var PRECACHE = [
  "./",
  "app/",
  "manifest.webmanifest",
  "favicon.ico",
  "assets/css/site.css",
  "assets/js/ai.js",
  "assets/js/boot.js",
  "assets/js/extract.js",
  "assets/js/report.js",
  "assets/js/similarity.js",
  "assets/js/sources.js",
  "assets/js/text.js",
  "assets/js/ui.js",
  "assets/js/wordfreq.js",
  "assets/vendor/fontkit.umd.min.js",
  "assets/vendor/mammoth.browser.min.js",
  "assets/vendor/pdf-lib.min.js",
  "assets/vendor/pdf.min.js",
  "assets/vendor/pdf.worker.min.js",
  "assets/fonts/LexendDeca-Medium.ttf",
  "assets/fonts/LexendDeca-SemiBold.ttf",
  "assets/fonts/NotoSans-Regular.ttf",
  "assets/fonts/NotoSans-SemiBold.ttf",
  "assets/fonts/Tinos-Bold.ttf",
  "assets/fonts/Tinos-BoldItalic.ttf",
  "assets/fonts/Tinos-Italic.ttf",
  "assets/fonts/Tinos-Regular.ttf",
  "assets/icons/apple-touch-icon.png",
  "assets/icons/favicon-32.png",
  "assets/icons/icon-192.png",
  "assets/icons/icon-512.png",
  "assets/icons/logo.svg",
  "assets/icons/maskable-192.png",
  "assets/icons/maskable-512.png",
  "assets/icons/maskable.svg"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(VERSION)
      .then(function (cache) { return cache.addAll(PRECACHE.map(function (u) { return new Request(u, { cache: "reload" }); })); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k.indexOf("tio-") === 0 && k !== VERSION; })
          .map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

/* Pages: network first so updates show at once, the saved copy when offline. */
function page(event) {
  var req = event.request;
  var home = new URL(req.url).pathname.indexOf("/app/") !== -1 ? "app/" : "./";
  return fetch(req, { cache: "no-cache" }).then(function (res) {
    if (res.ok) {
      var copy = res.clone();
      event.waitUntil(caches.open(VERSION).then(function (cache) { return cache.put(req, copy); }).catch(function () {}));
    }
    return res;
  }).catch(function () {
    return caches.open(VERSION).then(function (cache) {
      return cache.match(req, { ignoreSearch: true }).then(function (hit) { return hit || cache.match(home); });
    }).then(function (hit) { return hit || Response.error(); });
  });
}

/* Everything else from this site: the saved copy first, the network otherwise. Searches to other
   sites are never cached. */
function asset(event) {
  return caches.open(VERSION).then(function (cache) {
    return cache.match(event.request).then(function (hit) {
      return hit || fetch(event.request).then(function (res) {
        if (res.ok) cache.put(event.request, res.clone()).catch(function () {});
        return res;
      });
    });
  });
}

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;
  if (req.mode === "navigate") { event.respondWith(page(event)); return; }
  if (new URL(req.url).origin === self.location.origin) event.respondWith(asset(event));
});
