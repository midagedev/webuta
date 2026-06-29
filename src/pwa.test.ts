import { describe, expect, it } from 'vitest'
import { serviceWorkerUrl } from './pwa'

describe('PWA registration helpers', () => {
  it('builds the service worker URL for the local root base', () => {
    expect(serviceWorkerUrl('/')).toBe('/sw.js')
  })

  it('builds the service worker URL for GitHub Pages subpath deploys', () => {
    expect(serviceWorkerUrl('/webuta/')).toBe('/webuta/sw.js')
    expect(serviceWorkerUrl('/webuta')).toBe('/webuta/sw.js')
  })
})
