// G-HIMS Clinical PWA Service Worker (v1.0.0)
const CACHE_NAME = 'ghims-clinical-shell-v2';
const DATA_CACHE_NAME = 'ghims-clinical-data-v1';

const PRECACHE_ASSETS = [
  '/manifest.webmanifest',
  '/icon.png',
  '/favicon.ico',
];

// 1. Install Event: Pre-cache core shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        console.warn('Pre-caching partial failure, proceeding:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// 2. Activate Event: Clean up stale caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME && name !== DATA_CACHE_NAME) {
            return caches.delete(name);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 3. Fetch Event: Network-First for dynamic API & Navigation, Cache-First for static assets
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests (e.g. POST to /api are queued in IndexedDB)
  if (event.request.method !== 'GET') {
    return;
  }

  // Static Next.js Bundles & Assets: Cache-First
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.woff2')
  ) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return networkResponse;
        }).catch(() => {
          // Return empty or fallback if failed
          return new Response('', { status: 408, headers: { 'Content-Type': 'text/plain' } });
        });
      })
    );
    return;
  }

  // Only the PHI-free application shells are cacheable. G-HIMS clinical data is
  // rendered client-side from encrypted IndexedDB and is never embedded into
  // these server HTML shells.
  if (event.request.mode === 'navigate' || event.request.headers.get('accept')?.includes('text/html')) {
    const isSafeShell = url.pathname === '/' || url.pathname === '/login';

    if (isSafeShell) {
      event.respondWith(
        fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              const clone = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
            }
            return networkResponse;
          })
          .catch(async () => {
            const exact = await caches.match(event.request);
            if (exact) return exact;
            const rootShell = await caches.match('/');
            if (rootShell) return rootShell;
            return new Response(
              '<!doctype html><html><body><main><h1>G-HIMS edge shell unavailable</h1><p>Open G-HIMS once while online on this device before using offline restart.</p></main></body></html>',
              {
                status: 503,
                headers: {
                  'Content-Type': 'text/html; charset=utf-8',
                  'Cache-Control': 'no-store',
                },
              }
            );
          })
      );
      return;
    }

    // Never cache rendered clinical/deep-link HTML on shared workstations.
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(
          '<!doctype html><html><body><main><h1>G-HIMS is offline</h1><p>Return to the application home screen to continue from the encrypted edge cache.</p></main></body></html>',
          {
            status: 503,
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
              'Cache-Control': 'no-store',
            },
          }
        )
      )
    );
    return;
  }

  // Default Network with fallback
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

// 4. Background Sync Registration Event
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-clinical-queue') {
    event.waitUntil(notifyClientsToSync());
  }
});

// Broadcast to active browser tabs to run sync queue
async function notifyClientsToSync() {
  const clients = await self.clients.matchAll({ type: 'window' });
  for (const client of clients) {
    client.postMessage({
      type: 'TRIGGER_SYNC_QUEUE',
      timestamp: new Date().toISOString(),
    });
  }
}

// 5. Message Event
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
