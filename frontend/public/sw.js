/**
 * 🚀 BOOSTTRIBE SERVICE WORKER - V9 Auto-Update
 *
 * Mise à jour AUTOMATIQUE à chaque déploiement :
 * - skipWaiting() à l'install + clients.claim() à l'activate
 * - JS / CSS + navigation (app shell) : NETWORK FIRST → la dernière version se charge
 *   dès qu'elle est dispo ; le cache ne sert que de repli hors-ligne
 * - Images / fonts : Cache First (fichiers hashés/immuables)
 * - Audio (.mp3, .wav) + API Supabase : JAMAIS cachés (streaming / temps réel)
 *
 * ⚠️ Incrémenter CACHE_NAME à chaque changement de stratégie pour invalider l'ancien cache.
 */

const CACHE_NAME = 'boosttribe-v11-shell-network-only';
const CACHE_VERSION = '2.2.0';

// Assets à pré-cacher lors de l'installation.
// ⚠️ On NE pré-cache PLUS l'app shell (« / » et « /index.html ») : il doit TOUJOURS venir du réseau
//    (cf. networkOnlyNoStore) → plus jamais de version périmée servie après un déploiement.
const STATIC_ASSETS = [
  '/manifest.json',
  '/icon-192x192.png',
  '/icon-512x512.png',
  '/icon-512x512-maskable.png'
];

// URLs à TOUJOURS exclure du cache
const NEVER_CACHE_PATTERNS = [
  /\.mp3$/i,           // Fichiers audio MP3
  /\.wav$/i,           // Fichiers audio WAV
  /\.ogg$/i,           // Fichiers audio OGG
  /\.m4a$/i,           // Fichiers audio M4A
  /\.webm$/i,          // Fichiers audio/vidéo WebM
  /supabase\.co/,      // Toutes les requêtes Supabase
  /peerjs\.com/,       // Requêtes PeerJS
  /\.i\.posthog/,      // Analytics
  /realtime/,          // Websockets Realtime
  /\/api\//,           // API calls
  /audio-tracks/,      // Bucket audio Supabase
];

// URLs nécessitant Network First (toujours frais)
const NETWORK_FIRST_PATTERNS = [
  /\/session/,         // Pages de session
  /\/admin/,           // Pages admin
  /\/pricing/,         // Prix dynamiques
];

/**
 * Vérifie si une URL doit être exclue du cache
 */
function shouldNeverCache(url) {
  return NEVER_CACHE_PATTERNS.some(pattern => pattern.test(url));
}

/**
 * Vérifie si une URL nécessite Network First
 */
function shouldNetworkFirst(url) {
  return NETWORK_FIRST_PATTERNS.some(pattern => pattern.test(url));
}

// ============================================
// INSTALLATION
// ============================================
self.addEventListener('install', (event) => {
  console.log('🚀 Boosttribe SW: Installing v' + CACHE_VERSION);
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        // Pré-cache RÉSILIENT : un asset manquant (404) ne DOIT PLUS faire échouer tout l'install.
        // (cache.addAll est atomique → un seul 404 rejetait install → skipWaiting jamais appelé →
        //  l'ancien SW continuait de servir un bundle périmé.) allSettled tolère les échecs unitaires.
        return Promise.allSettled(STATIC_ASSETS.map((u) => cache.add(u)));
      })
      .then(() => {
        // Force activation immédiate (même si un asset a échoué au pré-cache)
        return self.skipWaiting();
      })
  );
});

// ============================================
// ACTIVATION
// ============================================
self.addEventListener('activate', (event) => {
  console.log('🚀 Boosttribe SW: Activating v' + CACHE_VERSION);
  
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            // Supprimer les anciens caches
            if (cacheName !== CACHE_NAME) {
              console.log('🚀 Boosttribe SW: Removing old cache:', cacheName);
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

// ============================================
// FETCH - Stratégies de cache
// ============================================
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = request.url;
  
  // Ignorer les requêtes non-GET
  if (request.method !== 'GET') return;
  
  // ⛔ JAMAIS CACHER : Audio, Supabase, APIs
  if (shouldNeverCache(url)) {
    return; // Laisser le navigateur gérer normalement
  }

  // 🌐 APP SHELL / NAVIGATION (index.html) : RÉSEAU UNIQUEMENT en no-store → JAMAIS servi depuis le cache.
  //    C'est LA cause des « vieilles versions après déploiement » : un shell caché référence d'anciens
  //    bundles hachés. On ne le met plus jamais en cache ; le repli cache ne sert qu'HORS-LIGNE.
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(networkOnlyNoStore(request));
    return;
  }

  // 🔄 NETWORK FIRST : Sessions, Admin, Pricing
  if (shouldNetworkFirst(url)) {
    event.respondWith(networkFirstStrategy(request));
    return;
  }
  
  // 🔄 NETWORK FIRST : JS / CSS (app shell) → la dernière version se charge dès qu'elle est dispo,
  // le cache ne sert que de repli hors-ligne. Indispensable pour voir les mises à jour après déploiement.
  if (request.destination === 'style' || request.destination === 'script') {
    event.respondWith(networkFirstStrategy(request));
    return;
  }

  // 📦 CACHE FIRST : images / fonts (fichiers hashés, immuables)
  if (request.destination === 'image' || request.destination === 'font') {
    event.respondWith(cacheFirstStrategy(request));
    return;
  }

  // 🌐 NETWORK FIRST par défaut pour la navigation / pages HTML
  event.respondWith(networkFirstStrategy(request));
});

/**
 * Stratégie Network Only (no-store) pour l'APP SHELL / la navigation.
 * Toujours le réseau, JAMAIS le cache (ni lecture ni écriture) → la dernière version se charge après
 * chaque déploiement, sans vider le cache. Repli sur cache UNIQUEMENT hors-ligne (dernier recours).
 */
async function networkOnlyNoStore(request) {
  try {
    return await fetch(request, { cache: 'no-store' });
  } catch (error) {
    // Hors-ligne uniquement : dernier recours (un shell éventuellement présent, sinon message hors-ligne).
    const cached = await caches.match('/index.html') || await caches.match('/');
    return cached || new Response('Hors ligne', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

/**
 * Stratégie Cache First
 * Retourne le cache si disponible, sinon fetch et cache
 */
async function cacheFirstStrategy(request) {
  const cachedResponse = await caches.match(request);
  
  if (cachedResponse) {
    return cachedResponse;
  }
  
  try {
    const networkResponse = await fetch(request);
    
    // Cacher la réponse si valide
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    // Fallback vers le cache si offline
    return caches.match('/') || new Response('Offline', { status: 503 });
  }
}

/**
 * Stratégie Network First
 * Toujours essayer le réseau d'abord, fallback sur cache
 */
async function networkFirstStrategy(request) {
  try {
    const networkResponse = await fetch(request);
    
    // Cacher la réponse si valide
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    // Fallback vers le cache si offline
    const cachedResponse = await caches.match(request);
    
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // Dernier recours : page d'accueil
    return caches.match('/') || new Response('Offline', { status: 503 });
  }
}

// ============================================
// MESSAGE HANDLER
// ============================================
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: CACHE_VERSION });
  }
});
