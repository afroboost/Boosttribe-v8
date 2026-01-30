/**
 * 🚀 BOOSTTRIBE SERVICE WORKER - V8 Stable Gold
 * 
 * Cache Strategy: Network First with Cache Fallback
 * - Assets statiques (CSS, JS, images) : Cache First
 * - API calls : Network First
 */

const CACHE_NAME = 'boosttribe-v8-gold';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.ico',
  '/icon-192x192.png',
  '/icon-512x512.png'
];

// Installation - Cache les assets essentiels
self.addEventListener('install', (event) => {
  console.log('🚀 Boosttribe SW: Installing...');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('🚀 Boosttribe SW: Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => {
        // Force activation immédiate
        return self.skipWaiting();
      })
  );
});

// Activation - Nettoie les anciens caches
self.addEventListener('activate', (event) => {
  console.log('🚀 Boosttribe SW: Activating...');
  
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              console.log('🚀 Boosttribe SW: Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        // Prendre le contrôle immédiatement
        return self.clients.claim();
      })
  );
});

// Fetch - Stratégie de cache
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Ignorer les requêtes non-GET
  if (request.method !== 'GET') return;
  
  // Ignorer les requêtes vers Supabase et APIs externes
  if (url.hostname.includes('supabase') || 
      url.hostname.includes('peerjs') ||
      url.pathname.startsWith('/api')) {
    return;
  }
  
  // Stratégie: Cache First pour les assets statiques
  if (request.destination === 'style' || 
      request.destination === 'script' || 
      request.destination === 'image' ||
      request.destination === 'font') {
    event.respondWith(
      caches.match(request)
        .then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          return fetch(request)
            .then((response) => {
              // Cloner la réponse pour la mettre en cache
              const responseToCache = response.clone();
              caches.open(CACHE_NAME)
                .then((cache) => {
                  cache.put(request, responseToCache);
                });
              return response;
            });
        })
    );
    return;
  }
  
  // Stratégie: Network First pour les pages HTML
  event.respondWith(
    fetch(request)
      .then((response) => {
        // Mettre en cache la réponse fraîche
        const responseToCache = response.clone();
        caches.open(CACHE_NAME)
          .then((cache) => {
            cache.put(request, responseToCache);
          });
        return response;
      })
      .catch(() => {
        // Fallback sur le cache si offline
        return caches.match(request)
          .then((cachedResponse) => {
            if (cachedResponse) {
              return cachedResponse;
            }
            // Fallback vers la page d'accueil
            return caches.match('/');
          });
      })
  );
});

// Message handler pour forcer la mise à jour
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
