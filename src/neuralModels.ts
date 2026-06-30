import type { NeuralModelCard } from './types'

export function createNeuralModelCards(localEndpoint: string): NeuralModelCard[] {
  const hasLocalEndpoint = Boolean(localEndpoint.trim())
  return [
    {
      id: 'webuta-ko-diffsinger-smoke',
      name: 'WebUtau KO DiffSinger Smoke',
      rendererId: 'local-neural',
      language: 'ko',
      status: hasLocalEndpoint ? 'ready' : 'blocked',
      releaseStatus: 'local-research',
      licenseSummary: 'CSD-derived smoke data and local OpenVPI vocoder artifacts stay research-only until reviewed.',
      usageNote: hasLocalEndpoint ? 'Local neural companion is configured.' : 'Local neural endpoint is not configured.',
      endpoint: hasLocalEndpoint ? localEndpoint : undefined,
    },
    {
      id: 'webuta-ko-production-v1',
      name: 'WebUtau KO Production Voice',
      rendererId: 'local-neural',
      language: 'ko',
      status: 'planned',
      releaseStatus: 'planned',
      licenseSummary: 'Requires a licensed Korean singing dataset or original singer consent before training.',
      usageNote: 'Target model for the first public-quality Korean neural singer.',
    },
  ]
}

export function mergeLocalNeuralModelCard(cards: NeuralModelCard[], serviceCard: NeuralModelCard): NeuralModelCard[] {
  const filtered = cards.filter((card) => card.id !== serviceCard.id && !(card.id === 'webuta-ko-diffsinger-smoke' && serviceCard.id !== card.id))
  return [serviceCard, ...filtered]
}
