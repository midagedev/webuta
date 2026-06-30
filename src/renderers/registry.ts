import type { RendererCapability } from '../types'
import { createNeuralModelCards } from '../neuralModels'
import { browserDemoRenderer } from './browserDemoRenderer'
import { createLocalNeuralRenderer, localNeuralRendererCapability } from './localNeuralRenderer'

export const localNeuralEndpoint = import.meta.env.VITE_WEBUTA_NEURAL_ENDPOINT?.trim() || ''
export const localNeuralRenderer = localNeuralEndpoint ? createLocalNeuralRenderer({ endpoint: localNeuralEndpoint }) : null
export const neuralModelCards = createNeuralModelCards(localNeuralEndpoint)

export const renderers = {
  browserDemo: browserDemoRenderer,
  localNeural: localNeuralRenderer,
}

export const rendererCapabilities: RendererCapability[] = [
  browserDemoRenderer.capability,
  localNeuralRendererCapability(localNeuralEndpoint),
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
