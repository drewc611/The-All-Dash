/*
 * Service worker: makes the app installable and usable offline.
 *
 * Every successful same-origin GET is cached (the shell, its hashed assets,
 * the manifest and icon) and served stale-while-revalidate: the cached copy
 * answers instantly and a fresh one is fetched for next time. Navigations
 * prefer the network so a new deploy shows on reload. Cross-origin requests
 * are never touched - the app has no API to talk to.
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
