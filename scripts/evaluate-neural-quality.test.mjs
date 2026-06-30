import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  analyzeCodaRepetition,
  analyzeF0Tracking,
  analyzeRenderedQuality,
  evaluateNeuralQuality,
  loadQualityPhraseSet,
  phraseToNeuralRequest,
} from './evaluate-neural-quality.mjs'

const tempRoots = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('neural quality evaluation', () => {
  it('loads the fixed phrase set and preserves Korean coda phones in requests', () => {
    const phraseSet = loadQualityPhraseSet()
    const phrase = phraseSet.phrases.find((item) => item.id === 'batchim-heavy')
    const request = phraseToNeuralRequest(phrase, phraseSet)

    expect(phraseSet.phrases).toHaveLength(6)
    expect(request.notes[0]).toMatchObject({
      lyric: '강',
      phonemes: [
        { symbol: 'g', role: 'onset' },
        { symbol: 'a', role: 'vowel' },
        { symbol: 'ng', role: 'coda' },
      ],
    })
    const codaSustain = phraseToNeuralRequest(phraseSet.phrases.find((item) => item.id === 'long-coda-sustain'), phraseSet)
    expect(codaSustain.notes[0]).toMatchObject({
      lyric: '연',
      durationSeconds: 1.2,
      phonemes: [
        { symbol: 'yeo', role: 'vowel' },
        { symbol: 'n', role: 'coda' },
      ],
    })
    expect(codaSustain.notes[0].phonemes.at(-1).startRatio).toBeGreaterThan(0.92)
  })

  it('tracks the target F0 of a synthetic sung vowel', () => {
    const phraseSet = makePhraseSet()
    const request = phraseToNeuralRequest(phraseSet.phrases[0], phraseSet)
    const samples = sineSamples(261.625565, 1, 44100)

    const f0 = analyzeF0Tracking(samples, 44100, request)

    expect(f0.estimatedFrameCount).toBeGreaterThan(50)
    expect(f0.voicedFrameRatio).toBeGreaterThan(0.8)
    expect(f0.medianAbsCents).toBeLessThan(12)
  })

  it('flags repeated coda-like bursts inside a long coda note sustain', () => {
    const phraseSet = makeCodaPhraseSet()
    const request = phraseToNeuralRequest(phraseSet.phrases[0], phraseSet)
    const stable = codaSustainSamples({ repeatedBursts: false })
    const repeated = codaSustainSamples({ repeatedBursts: true })

    const stableCoda = analyzeCodaRepetition(stable, 44100, request)
    const repeatedCoda = analyzeCodaRepetition(repeated, 44100, request)

    expect(stableCoda.codaNoteCount).toBe(1)
    expect(stableCoda.maxSustainBurstCount).toBeLessThanOrEqual(1)
    expect(repeatedCoda.maxSustainBurstCount).toBeGreaterThan(1)
  })

  it('writes quality diagnostics for a fake local neural render run', async () => {
    const root = makeTempRoot()
    const phraseSetPath = join(root, 'phrases.json')
    const out = join(root, 'quality-run')
    const phraseSet = makePhraseSet()
    writeFileSync(phraseSetPath, `${JSON.stringify(phraseSet, null, 2)}\n`)
    const runtime = makeRuntime(root)

    const summary = await evaluateNeuralQuality({
      phraseSet: phraseSetPath,
      out,
      acceptLocalResearchLicense: true,
      runner: fakeRunner,
      ...runtime,
    })

    expect(summary.totals).toMatchObject({
      phraseCount: 1,
      renderedCount: 1,
      okCount: 1,
    })
    expect(summary.results[0]).toMatchObject({
      ok: true,
      gates: {
        passed: true,
      },
    })
    expect(readFileSync(join(out, 'quality-summary.json'), 'utf8')).toContain('single-sine')
    const listeningTemplate = JSON.parse(readFileSync(join(out, 'listening-scores.template.json'), 'utf8'))
    expect(listeningTemplate).toMatchObject({
      version: 1,
      runId: summary.runId,
      modelId: 'webuta-ko-neural-dev',
      phraseScores: [{ id: 'single-sine', koreanClarityScore: null }],
    })
    expect(readFileSync(summary.results[0].qualityPath, 'utf8')).toContain('medianAbsCents')
  })

  it('analyzes duration, loudness, and onset from a rendered WAV artifact', () => {
    const root = makeTempRoot()
    const phraseSet = makePhraseSet()
    const phrase = phraseSet.phrases[0]
    const request = phraseToNeuralRequest(phrase, phraseSet)
    const wavPath = join(root, 'render.wav')
    writePcmWav(wavPath, sineSamples(261.625565, 1, 44100), 44100)

    const diagnostics = analyzeRenderedQuality({
      request,
      phrase,
      phraseSet,
      response: {
        diagnostics: {
          renderSeconds: 0.2,
          warnings: [],
          artifacts: { wavPath },
        },
      },
      wavPath,
    })

    expect(diagnostics.audio.rms).toBeGreaterThan(0.05)
    expect(diagnostics.duration.absDeltaSeconds).toBeLessThan(0.001)
    expect(diagnostics.onset.missingOnsetRatio).toBe(0)
    expect(diagnostics.gates.passed).toBe(true)
  })

  it('does not count soft nasal onsets as missing energy attacks', () => {
    const root = makeTempRoot()
    const phraseSet = makeNasalOnsetPhraseSet()
    const phrase = phraseSet.phrases[0]
    const request = phraseToNeuralRequest(phrase, phraseSet)
    const wavPath = join(root, 'nasal.wav')
    writePcmWav(wavPath, sineSamples(261.625565, 1, 44100), 44100)

    const diagnostics = analyzeRenderedQuality({
      request,
      phrase,
      phraseSet,
      response: {
        diagnostics: {
          renderSeconds: 0.2,
          warnings: [],
          artifacts: { wavPath },
        },
      },
      wavPath,
    })

    expect(diagnostics.onset.onsetBearingNoteCount).toBe(0)
    expect(diagnostics.onset.missingOnsetRatio).toBe(0)
    expect(diagnostics.gates.failed).not.toContain('missing-onset-ratio')
  })
})

function makePhraseSet() {
  return {
    version: 1,
    id: 'test-phrases',
    sampleRate: 44100,
    language: 'ko',
    renderer: 'diffsinger',
    phrases: [
      {
        id: 'single-sine',
        title: '아',
        purpose: 'test phrase',
        bpm: 120,
        notes: [{ lyric: '아', midi: 60, durationSeconds: 1 }],
      },
    ],
    betaThresholds: {
      durationToleranceSeconds: 0.02,
      maxClippingSamples: 0,
      minRms: 0.005,
      maxRms: 0.25,
      minVoicedFrameRatio: 0.8,
      maxMedianAbsCents: 20,
      maxMedianOnsetLagSeconds: 0.03,
      maxMissingOnsetRatio: 0,
    },
  }
}

function makeCodaPhraseSet() {
  return {
    ...makePhraseSet(),
    phrases: [
      {
        id: 'coda-sustain',
        title: '연',
        purpose: 'test coda sustain phrase',
        bpm: 84,
        notes: [{ lyric: '연', midi: 60, durationSeconds: 1.2 }],
      },
    ],
    betaThresholds: {
      ...makePhraseSet().betaThresholds,
      maxCodaSustainBurstCount: 1,
    },
  }
}

function makeNasalOnsetPhraseSet() {
  return {
    ...makePhraseSet(),
    phrases: [
      {
        id: 'nasal-onset',
        title: '나',
        purpose: 'test nasal onset phrase',
        bpm: 120,
        notes: [{ lyric: '나', midi: 60, durationSeconds: 1 }],
      },
    ],
  }
}

function makeRuntime(root) {
  const diffSingerRoot = join(root, 'DiffSinger')
  const python = join(root, 'python')
  const exp = join(root, 'train-smoke')
  const vocoder = 'checkpoints/pc_nsf_hifigan_44.1k_hop512_128bin_2025.02/model.ckpt'

  mkdirSync(join(diffSingerRoot, 'scripts'), { recursive: true })
  mkdirSync(join(diffSingerRoot, 'checkpoints/pc_nsf_hifigan_44.1k_hop512_128bin_2025.02'), { recursive: true })
  mkdirSync(exp, { recursive: true })
  writeFileSync(join(diffSingerRoot, 'scripts/infer.py'), '# fake infer.py\n')
  writeFileSync(join(diffSingerRoot, vocoder), 'fake vocoder\n')
  writeFileSync(join(exp, 'model_ckpt_steps_1.ckpt'), 'fake checkpoint\n')
  writeFileSync(python, '# fake python\n')

  return {
    diffSingerRoot,
    python,
    exp,
    ckpt: 1,
    vocoder,
  }
}

function fakeRunner(config) {
  writePcmWav(join(config.outputDir, `${config.title}.wav`), sineSamples(261.625565, 1, 44100), 44100)
}

function sineSamples(hz, seconds, sampleRate) {
  const samples = new Float32Array(Math.round(seconds * sampleRate))
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = Math.sin((2 * Math.PI * hz * index) / sampleRate) * 0.12
  }
  return samples
}

function codaSustainSamples({ repeatedBursts }) {
  const sampleRate = 44100
  const samples = sineSamples(261.625565, 1.2, sampleRate)
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] *= 0.72 + Math.sin(index / sampleRate * Math.PI * 2 * 3) * 0.02
  }
  const burstTimes = repeatedBursts ? [0.34, 0.52, 0.7, 0.88] : [1.1]
  for (const time of burstTimes) {
    addNoiseBurst(samples, sampleRate, time, 0.035)
  }
  return samples
}

function addNoiseBurst(samples, sampleRate, timeSeconds, durationSeconds) {
  const start = Math.max(0, Math.round(timeSeconds * sampleRate))
  const length = Math.max(1, Math.round(durationSeconds * sampleRate))
  for (let index = 0; index < length && start + index < samples.length; index += 1) {
    const progress = index / length
    const envelope = Math.sin(Math.PI * progress) ** 2
    const noise = ((index * 1103515245 + 12345) % 65536) / 32768 - 1
    samples[start + index] += noise * envelope * 0.24
  }
}

function writePcmWav(path, samples, sampleRate) {
  const dataBytes = samples.length * 2
  const buffer = Buffer.alloc(44 + dataBytes)
  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(36 + dataBytes, 4)
  buffer.write('WAVE', 8, 'ascii')
  buffer.write('fmt ', 12, 'ascii')
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36, 'ascii')
  buffer.writeUInt32LE(dataBytes, 40)
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]))
    buffer.writeInt16LE(sample < 0 ? sample * 0x8000 : sample * 0x7fff, 44 + index * 2)
  }
  writeFileSync(path, buffer)
}

function makeTempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'webuta-neural-quality-'))
  tempRoots.push(root)
  return root
}
