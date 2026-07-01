/* Monograph — minimal service worker.
 *
 * Ponytail: network-first, fallback to cache for navigations + assets del
 * shell. Cero offline-first (la app requiere auth, no tiene sentido cachear
 * datos de usuario sin sync). Solo queremos que el shell se sienta instalado:
 * re-visitas cargan el layout/JS/CSS del caché en vez de pegarle al origen.
 *
 * El SW solo cachea lo que el server lo deja cachear (assets versionados de
 * Next con hashes en el nombre) y un set curado de URLs del app shell en el
 * install. Las llamadas a /api/* SIEMPRE van a la red — no stale data.
 */

const CACHE_NAME = 'monograph-shell-v1'
const SHELL_ASSETS = [
  '/',
  '/manifest.webmanifest',
  '/icon-192x192.png',
  '/icon-512x512.png',
  '/apple-icon-180x180.png',
]

self.addEventListener('install', (event) => {
  // Pre-cache del shell. Si falla una URL, no rompemos el install —
  // el SW sigue siendo usable para el resto.
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        SHELL_ASSETS.map((url) =>
          cache.add(url).catch((err) => {
            console.warn('[sw] pre-cache failed for', url, err)
          })
        )
      )
    )
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  // Limpieza de caches viejos.
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // API y SSE: nunca cachear.
  if (url.pathname.startsWith('/api/')) return

  // Network-first para todo lo demás; fallback al cache si offline.
  event.respondWith(
    fetch(request)
      .then((response) => {
        // Solo cachear 200s; errores no entran al cache.
        if (response && response.status === 200 && response.type === 'basic') {
          const copy = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
        }
        return response
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match('/')))
  )
})
