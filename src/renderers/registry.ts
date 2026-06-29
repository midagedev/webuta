import type { RendererCapability } from '../types'
import { browserDemoRenderer } from './browserDemoRenderer'

export const renderers = {
  browserDemo: browserDemoRenderer,
}

export const rendererCapabilities: RendererCapability[] = [
  browserDemoRenderer.capability,
  {
    id: 'openutau-server',
    name: 'OpenUtau Server Renderer',
    status: 'planned',
    exportWav: true,
    realtimePreview: false,
    notes: 'Runs the desktop-compatible OpenUtau render path outside the browser sandbox.',
  },
  {
    id: 'worldline-wasm',
    name: 'WORLDLINE WASM Renderer',
    status: 'planned',
    exportWav: true,
    realtimePreview: true,
    notes: 'A future client-side renderer after native WORLDLINE code is compiled to WebAssembly.',
  },
]
