/* nexaPOS app-shell cache. It only stores the app's own files so the till can open without internet.
   It never touches /api: business data, sessions and payments always go to the network (or the till's own queue). */
const VERSION = "nexa-shell-v1";
const SHELL = ["/index.html", "/manifest.webmanifest", "/favicon.svg", "/icon-192.png", "/icon-512.png"];

// On install, save the page AND the built files it points at (they loaded before this worker took control,
// so the fetch handler never saw them). If any piece fails, install fails and is retried: no half-saved shell.
async function precache() {
  const cache = await caches.open(VERSION);
  const res = await fetch("/index.html", { cache: "no-cache" });
  if (!res.ok) throw new Error("index.html unavailable");
  const html = await res.clone().text();
  await cache.put("/index.html", res);
  const assets = [...new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]))];
  await cache.addAll([...SHELL.filter((u) => u !== "/index.html"), ...assets]);
}

self.addEventListener("install", (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // third parties: leave alone
  if (url.pathname.startsWith("/api")) return; // never cache business data

  // Opening the app: newest page when online, the saved one when not.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put("/index.html", copy)); }
        return res;
      }).catch(() => caches.match("/index.html").then((r) => r || caches.match("/")))
    );
    return;
  }

  // Built files have a hash in their name, so a saved copy is always the right one.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
        return res;
      }))
    );
    return;
  }

  // Icons, manifest: saved copy first, refreshed in the background.
  event.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); } return res; }).catch(() => hit);
      return hit || net;
    })
  );
});
