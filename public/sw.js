const CACHE_NAME = 'webuta-app-shell-v4'

function scopedUrl(path) {
  return new URL(path, self.registration.scope).toString()
}

const PRECACHE_URLS = [
  './',
  './manifest.webmanifest',
  './favicon.svg',
  './apple-touch-icon.png',
  './pwa-icon-192.png',
  './pwa-icon-512.png',
].map(scopedUrl)

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then(cacheAppShell).catch(() => undefined))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== location.origin || !url.href.startsWith(self.registration.scope)) {
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, scopedUrl('./')))
    return
  }

  event.respondWith(networkFirst(request))
})

async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(CACHE_NAME)
  try {
    const response = await fetch(request)
    if (response.ok) {
      await cache.put(request, response.clone())
    }
    return response
  } catch {
    return (await cache.match(request)) ?? (fallbackUrl ? await cache.match(fallbackUrl) : undefined) ?? Response.error()
  }
}

async function cacheAppShell(cache) {
  const rootUrl = scopedUrl('./')
  const response = await fetch(rootUrl, { cache: 'no-store' })
  if (response.ok) {
    await cache.put(rootUrl, response.clone())
    const html = await response.text()
    await cache.addAll([...new Set([...PRECACHE_URLS, ...assetUrlsFromHtml(html, rootUrl)])])
    return
  }
  await cache.addAll(PRECACHE_URLS)
}

function assetUrlsFromHtml(html, baseUrl) {
  return [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((match) => new URL(match[1], baseUrl).toString())
    .filter((url) => url.startsWith(self.registration.scope))
}
