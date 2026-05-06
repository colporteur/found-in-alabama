// Service worker for the Found in Alabama admin PWA. Two jobs:
//   1. Cache static assets (icons, photos, JS bundles) so the shell loads
//      instantly on repeat visits.
//   2. Fall back to the cached /admin shell when the network is offline,
//      so the app icon doesn't break when Todd is somewhere with no signal.
//
// API calls (/api/*) are NEVER cached — eBay data must always be fresh.

const CACHE_VERSION = "fia-admin-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      // Pre-cache the admin shell. Don't fail install if any of these
      // 404 — Next.js asset URLs change between deploys.
      await cache.addAll(["/admin", "/logo.png"]).catch(() => {});
      self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Cross-origin (eBay images, etc.) — let the browser handle it.
  if (url.origin !== self.location.origin) return;

  // API calls — always go to the network, never cache.
  if (url.pathname.startsWith("/api/")) return;

  // OAuth callback — must hit network with full headers.
  if (url.pathname.startsWith("/admin/ebay/sales/connect")) return;

  // Static assets — cache-first.
  if (
    url.pathname.startsWith("/_next/static/") ||
    /\.(png|jpg|jpeg|svg|ico|webp|woff2?)$/i.test(url.pathname)
  ) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_VERSION);
        const cached = await cache.match(req);
        if (cached) return cached;
        try {
          const res = await fetch(req);
          if (res.ok) cache.put(req, res.clone());
          return res;
        } catch (err) {
          return cached || Response.error();
        }
      })()
    );
    return;
  }

  // HTML pages — network-first, fall back to cached shell.
  if (req.mode === "navigate" || req.headers.get("accept")?.includes("text/html")) {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          // Cache successful HTML for offline fallback.
          if (res.ok) {
            const cache = await caches.open(CACHE_VERSION);
            cache.put(req, res.clone());
          }
          return res;
        } catch (err) {
          const cache = await caches.open(CACHE_VERSION);
          const cached = await cache.match(req);
          if (cached) return cached;
          return cache.match("/admin") || Response.error();
        }
      })()
    );
  }
});
