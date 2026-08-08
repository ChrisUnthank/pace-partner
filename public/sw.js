/* Strider service worker
 *
 * Two jobs, kept deliberately separate:
 *   1. Push notifications (pre-existing — untouched below).
 *   2. PWA installability + a real offline fallback (new).
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: cache the app's JS/CSS bundles or any
 * Supabase/API response. This is a frequently-deployed SPA with hashed build
 * assets — a service worker that cache-first's those is the classic PWA
 * footgun, where a user reopens the app days after a deploy and is silently
 * served stale JS, or worse, stale auth/data state. Full app-shell offline
 * support (the UI itself still loading with no network) needs a real
 * build-integrated precache manifest (e.g. Workbox/vite-plugin-pwa, tied to
 * each build's actual asset hashes) which this project's Lovable-managed
 * vite config doesn't currently support without conflicting with its own
 * plugin list. This is the safe, honest subset: a handful of static,
 * rarely-changing files (icons, manifest, this offline page) are cached by
 * URL, and everything else always goes to the network, full stop.
 */

const CACHE_VERSION = "strider-shell-v1";
const PRECACHE_URLS = [
  "/offline.html",
  "/favicon.ico",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .catch(() => {
        /* best-effort — a precache failure must never block install/activate,
           since push notifications (the pre-existing, higher-stakes job of
           this file) don't depend on any of this */
      })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE_VERSION).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

// Lets a future "update available, reload?" UI trigger the waiting worker to
// activate immediately rather than waiting for every tab to close. Not wired
// up to any UI yet — cheap to add now, nothing to break by including it.
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never touch cross-origin (Supabase, fonts, tiles, etc.)

  // Navigations (actual page loads / SPA route entries): network-first, with
  // the cached offline page as the fallback ONLY on genuine network failure.
  // A successful response is never cached here — this is a fallback, not a
  // navigation cache — so every real page load still gets fresh HTML/routing.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => caches.match("/offline.html").then((res) => res || Response.error())),
    );
    return;
  }

  // The small precached static set: cache-first, since these are
  // content-addressed-in-spirit (an icon/manifest update ships as part of a
  // new deploy, at which point CACHE_VERSION above should be bumped to
  // invalidate this cache entirely rather than relying on a per-file check).
  if (PRECACHE_URLS.includes(url.pathname)) {
    event.respondWith(caches.match(req).then((res) => res || fetch(req)));
    return;
  }

  // Everything else (hashed JS/CSS bundles, API calls, images) — untouched,
  // straight to network. No respondWith call at all, so the browser's
  // default fetch handling applies exactly as if this worker didn't exist.
});

self.addEventListener("push", (event) => {
  let payload = { title: "Strider", body: "You have a new notification", link: "/app" };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch (_) {
    if (event.data) payload.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      data: { link: payload.link },
      icon: "/icons/icon-192.png",
      badge: "/favicon.ico",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || "/app";
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      for (const c of clients) {
        if ("focus" in c) {
          c.navigate(link);
          return c.focus();
        }
      }
      return self.clients.openWindow(link);
    }),
  );
});
