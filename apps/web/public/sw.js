/*
 * Cortex service worker.
 *
 * Three strategies, chosen by what the request actually is:
 *  - navigations: network first, fall back to the cached shell, then /offline
 *  - static assets: cache first, they are content-hashed
 *  - API GETs: network first with a short-lived cache so the last known feed
 *    and task list are readable on a plane
 *
 * Mutations made offline are queued in IndexedDB and replayed on reconnect.
 * Nothing here touches AI: the model lives on the iPhone, and this worker only
 * decides which bytes come from the network and which from the cache.
 */
const VERSION = 'cortex-v1';
const SHELL_CACHE = `${VERSION}-shell`;
const DATA_CACHE = `${VERSION}-data`;
const OFFLINE_URL = '/offline';

const SHELL_ASSETS = ['/offline', '/manifest.webmanifest', '/icons/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request, cacheName, fallbackUrl) {
  try {
    const response = await fetch(request);
    if (response.ok && request.method === 'GET') {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (fallbackUrl) {
      const fallback = await caches.match(fallbackUrl);
      if (fallback) return fallback;
    }
    throw error;
  }
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(cacheName);
    cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;

  // Never cache auth: a stale session response is worse than an error.
  if (url.pathname.startsWith('/auth/')) return;

  if (request.method !== 'GET') {
    event.respondWith(
      fetch(request).catch(async () => {
        await queueMutation(request.clone());
        return new Response(JSON.stringify({ queued: true, message: 'Saved offline. It will sync when you reconnect.' }), {
          status: 202,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, SHELL_CACHE, OFFLINE_URL));
    return;
  }

  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request, DATA_CACHE));
  }
});

/* ------------------------------------------------------------------ */
/* Offline mutation queue                                              */
/* ------------------------------------------------------------------ */

const DB_NAME = 'cortex-offline';
const STORE = 'mutations';

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function queueMutation(request) {
  try {
    const body = await request.text();
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).add({
        url: request.url,
        method: request.method,
        headers: [...request.headers.entries()],
        body,
        queuedAt: Date.now(),
      });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    if ('sync' in self.registration) {
      await self.registration.sync.register('cortex-replay');
    }
  } catch (error) {
    console.warn('could not queue this change for later', error);
  }
}

async function replayQueue() {
  const db = await openDb();
  const entries = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  for (const entry of entries) {
    try {
      const response = await fetch(entry.url, {
        method: entry.method,
        headers: new Headers(entry.headers),
        body: entry.body || undefined,
      });
      if (!response.ok && response.status < 500) continue;
      await new Promise((resolve) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(entry.id);
        tx.oncomplete = resolve;
      });
    } catch {
      // Still offline - leave the rest of the queue for the next attempt.
      break;
    }
  }
}

self.addEventListener('sync', (event) => {
  if (event.tag === 'cortex-replay') event.waitUntil(replayQueue());
});

self.addEventListener('message', (event) => {
  if (event.data === 'cortex-replay') event.waitUntil(replayQueue());
});
