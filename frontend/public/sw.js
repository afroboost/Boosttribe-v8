/**
 * 🚀 BOOSTTRIBE SERVICE WORKER - V8 Stable Gold
 * 
 * Stratégies de cache :
 * - Assets statiques (CSS, JS, images) : Cache First
 * - Pages HTML : Network First avec fallback cache
 * - Page /session : Network First (toujours frais pour sync)
 * - Audio (.mp3, .wav) : JAMAIS caché (streaming)
 * - API Supabase : JAMAIS caché (temps réel)
 */

const CACHE_NAME = 'boosttribe-v8-gold';
const CACHE_VERSION = '1.0.0';

// Assets à pré-cacher lors de l'installation
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.ico',
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
        // Pré-cacher les assets statiques
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => {
        // Force activation immédiate
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
  
  // 🔄 NETWORK FIRST : Sessions, Admin, Pricing
  if (shouldNetworkFirst(url)) {
    event.respondWith(networkFirstStrategy(request));
    return;
  }
  
  // 📦 CACHE FIRST : Assets statiques (CSS, JS, images, fonts)
  if (request.destination === 'style' || 
      request.destination === 'script' || 
      request.destination === 'image' ||
      request.destination === 'font') {
    event.respondWith(cacheFirstStrategy(request));
    return;
  }
  
  // 🌐 NETWORK FIRST par défaut pour les pages HTML
  event.respondWith(networkFirstStrategy(request));
});

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
