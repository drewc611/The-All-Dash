/*
 * Service worker: makes the app installable and usable offline.
 *
 * Strategy is stale-while-revalidate for same-origin GETs. The shell loads
 * from cache instantly, and a fresh copy is fetched in the background for next
 * time. Nothing else is cached - the app has no API to talk to.
 */
const CACHE = 'all-dash-v1'

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(['/', '/index.html', '/manifest.webmanifest', '/icon.svg'])))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request)
      const network = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone())
          return response
        })
        .catch(() => cached)
      // Navigations prefer the network so a new deploy shows up on reload;
      // hashed assets prefer the cache because their content never changes.
      if (request.mode === 'navigate') return network.then((r) => r || cached)
      return cached || network
    })
  )
})
