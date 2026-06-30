import { describe, expect, it } from 'vitest'
import { createNeuralModelCards, mergeLocalNeuralModelCard } from './neuralModels'

describe('neural model cards', () => {
  it('marks the local DiffSinger smoke model blocked without an endpoint', () => {
    const [localModel] = createNeuralModelCards('')

    expect(localModel).toMatchObject({
      id: 'webuta-ko-diffsinger-smoke',
      rendererId: 'local-neural',
      status: 'blocked',
      releaseStatus: 'local-research',
      endpoint: undefined,
    })
    expect(localModel.licenseSummary).toContain('research-only')
  })

  it('marks the local DiffSinger smoke model ready when an endpoint is configured', () => {
    const [localModel] = createNeuralModelCards('http://127.0.0.1:8787/render')

    expect(localModel).toMatchObject({
      status: 'ready',
      endpoint: 'http://127.0.0.1:8787/render',
    })
  })

  it('replaces the smoke placeholder with the current service model card', () => {
    const cards = mergeLocalNeuralModelCard(createNeuralModelCards('http://127.0.0.1:8787/render'), {
      id: 'webuta-ko-v1',
      name: 'WebUtau KO V1',
      rendererId: 'local-neural',
      language: 'ko',
      status: 'ready',
      releaseStatus: 'private-lab',
      licenseSummary: 'Consent-reviewed private model.',
      usageNote: 'Checkpoint 200000 is available.',
      endpoint: 'http://127.0.0.1:8787/render',
    })

    expect(cards.map((card) => card.id)).toEqual(['webuta-ko-v1', 'webuta-ko-production-v1'])
  })
})
