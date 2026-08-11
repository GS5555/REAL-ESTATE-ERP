/* Service worker: app-shell cache + network-first API GETs + offline mutation queue */
const CACHE = 'propease-v4';
const SHELL = ['/', '/index.html', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isApiGet(url) {
  return url.pathname.startsWith('/api/') && url.method === 'GET';
}

// Navigation (HTML document) requests are network-first so a fresh build's
// index.html is always served after a deploy; the cached shell is only a
// fallback for when we are offline. Stale HTML is what previously caused
// "MIME type text/html" errors when old hashed JS chunks were purged.
function isNavigation(req) {
  return req.mode === 'navigate' || (req.method === 'GET' && req.headers.get('accept')?.includes('text/html'));
}

self.addEventListener('fetch', (e) => {
  let url;
  try { url = new URL(e.request.url); } catch { return; }
  if (url.origin !== location.origin) return;

  if (isApiGet(url)) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(e.request).then((hit) => hit || Response.json({ error: 'Offline and no cache available' }, { status: 503 })))
    );
    return;
  }

  if (e.request.method === 'GET') {
    if (isNavigation(e.request)) {
      e.respondWith(
        fetch(e.request).then((res) => {
          if (res.ok) caches.open(CACHE).then((c) => c.put(e.request, res.clone())).catch(() => {});
          return res;
        }).catch(() => caches.match('/').then((fallback) => fallback || Response.json({ error: 'Offline and no cache available' }, { status: 503 })))
      );
      return;
    }
    e.respondWith(
      caches.match(e.request).then((hit) => {
        if (hit) return hit;
        return fetch(e.request).then((res) => {
          if (res.ok) caches.open(CACHE).then((c) => c.put(e.request, res.clone())).catch(() => {});
          return res;
        }).catch(() => caches.match('/').then((fallback) => fallback || Response.json({ error: 'Offline and no cache available' }, { status: 503 })));
      })
    );
    return;
  }

  // Mutations: try network; if offline, queue for replay
  e.respondWith(
    fetch(e.request).catch(() => {
      const copy = e.request.clone();
      return copy.text().then((text) => enqueue({
        url: e.request.url, method: e.request.method, headers: Object.fromEntries(e.request.headers.entries()), body: text
      })).then(() => Response.json({ ok: true, queued: true }, { status: 202 }));
    })
  );
});

/* ---- IndexedDB mutation queue ---- */
const DB = 'propease-offline';
function openDb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('queue', { keyPath: 'id', autoIncrement: true });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
function enqueue(item) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction('queue', 'readwrite');
    tx.objectStore('queue').add(item);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  }));
}
function drain() {
  return openDb().then((db) => new Promise((resolve) => {
    const tx = db.transaction('queue', 'readonly');
    const req = tx.objectStore('queue').getAll();
    req.onsuccess = async () => {
      const items = req.result;
      for (const item of items) {
        try {
          const res = await fetch(item.url, { method: item.method, headers: { ...item.headers, 'Content-Type': 'application/json' }, body: item.body });
          if (res.ok || res.status >= 400 && res.status < 500) {
            const dtx = db.transaction('queue', 'readwrite');
            dtx.objectStore('queue').delete(item.id);
          }
        } catch {}
      }
      resolve();
    };
  }));
}

self.addEventListener('message', (e) => {
  if (e.data === 'sync') drain();
});
self.addEventListener('sync', () => drain());
