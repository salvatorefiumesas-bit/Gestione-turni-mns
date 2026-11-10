// Service worker: l'app si apre anche senza rete.
// Cambia il numero di versione ad ogni aggiornamento dei file per forzare il rinnovo della cache.
const VERSION = "turni-v4";
const FB = "https://www.gstatic.com/firebasejs/10.14.1/";
const FB_FILES = ["firebase-app.js", "firebase-auth.js", "firebase-firestore.js"].map(f => FB + f);
const SHELL = [
  "./", "index.html", "sync.js", "firebase-config.js", "manifest.webmanifest",
  "icon-192.png", "icon-512.png", "icon-maskable-192.png",
  "icon-maskable-512.png", "apple-touch-icon.png", "favicon-32.png", "favicon-16.png"
];

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await Promise.allSettled(SHELL.map(u => c.add(new Request(u, { cache: "reload" }))));
    // Librerie Firebase (cross-origin, richieste CORS dei moduli)
    await Promise.allSettled(FB_FILES.map(async u => { const r = await fetch(u, { mode: "cors" }); if (r.ok) await c.put(u, r); }));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith("turni-") && k !== VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function networkFirst(req) {
  const c = await caches.open(VERSION);
  try {
    const r = await Promise.race([
      fetch(req),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 4000))
    ]);
    if (r && r.ok) c.put(req, r.clone());
    return r;
  } catch (err) {
    const hit = (await c.match(req, { ignoreSearch: true })) || (req.mode === "navigate" ? await c.match("index.html") : null);
    if (hit) return hit;
    throw err;
  }
}
async function cacheFirst(req) {
  const c = await caches.open(VERSION);
  const hit = await c.match(req);
  if (hit) return hit;
  const r = await fetch(req);
  if (r && r.ok) c.put(req, r.clone());
  return r;
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === location.origin) { e.respondWith(networkFirst(req)); return; }
  if (url.href.startsWith("https://www.gstatic.com/firebasejs/")) { e.respondWith(cacheFirst(req)); return; }
  // tutto il resto (API Firebase/Auth/Firestore) passa direttamente in rete
});
