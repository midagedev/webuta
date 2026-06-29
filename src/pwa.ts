export function serviceWorkerUrl(baseUrl: string) {
  return `${baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`}sw.js`
}

export function registerPwa(baseUrl = import.meta.env.BASE_URL, enabled = import.meta.env.PROD) {
  if (!enabled || !('serviceWorker' in navigator)) {
    return
  }
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(serviceWorkerUrl(baseUrl))
  })
}
