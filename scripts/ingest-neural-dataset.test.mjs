import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ingestNeuralDataset } from './ingest-neural-dataset.mjs'

const tempRoots = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('neural dataset ingestion', () => {
  it('segments a local WAV dataset and writes diagnostics', () => {
    const root = makeTempRoot()
    const datasetRoot = join(root, 'dataset')
    const outputRoot = join(root, 'out')
    const registryPath = join(root, 'registry.json')
    mkdirSync(datasetRoot, { recursive: true })
    writeFileSync(join(datasetRoot, 'phrase.wav'), makeSineWav({ sampleRate: 8000, seconds: 1, hz: 440 }))
    writeFileSync(join(datasetRoot, 'phrase.txt'), '강남 밤하늘')
    writeFileSync(registryPath, JSON.stringify(makeRegistry(datasetRoot, true), null, 2))

    const { summary, segments } = ingestNeuralDataset({
      registry: registryPath,
      dataset: 'mini-ko',
      out: outputRoot,
      targetRate: 16000,
      segmentSeconds: 0.4,
      minSegmentSeconds: 0.15,
    })

    expect(summary.files).toMatchObject({ audioCount: 1, skippedCount: 0 })
    expect(summary.segments.count).toBe(3)
    expect(summary.segments.totalDurationSeconds).toBeCloseTo(1, 4)
    expect(summary.segments.medianPitchHz.median).toBeGreaterThan(390)
    expect(summary.segments.medianPitchHz.median).toBeLessThan(500)
    expect(summary.lyricCoverage).toMatchObject({ annotatedFiles: 1, hangulSyllableCount: 5 })
    expect(summary.lyricCoverage.uniqueHangulSyllables).toEqual(['강', '남', '늘', '밤', '하'])
    expect(summary.lyricCoverage.uniquePhonemes).toContain('ng')
    expect(segments[0]).toMatchObject({
      datasetId: 'mini-ko',
      sourceRelative: 'phrase.wav',
      targetSampleRate: 16000,
      sourceSampleRate: 8000,
      annotationText: '강남 밤하늘',
    })
    expect(JSON.parse(readFileSync(join(outputRoot, 'summary.json'), 'utf8')).segments.count).toBe(3)
    expect(readFileSync(join(outputRoot, 'segments.jsonl'), 'utf8').trim().split('\n')).toHaveLength(3)
  })

  it('blocks ingestion unless local training is allowed or explicitly overridden', () => {
    const root = makeTempRoot()
    const datasetRoot = join(root, 'dataset')
    const registryPath = join(root, 'registry.json')
    mkdirSync(datasetRoot, { recursive: true })
    writeFileSync(join(datasetRoot, 'phrase.wav'), makeSineWav({ sampleRate: 8000, seconds: 0.25, hz: 220 }))
    writeFileSync(registryPath, JSON.stringify(makeRegistry(datasetRoot, false), null, 2))

    expect(() =>
      ingestNeuralDataset({
        registry: registryPath,
        dataset: 'mini-ko',
        out: join(root, 'out'),
      }),
    ).toThrow(/localTraining=true/)
  })

  it('does not ingest headphone guide WAVs as training segments', () => {
    const root = makeTempRoot()
    const datasetRoot = join(root, 'dataset')
    const guideRoot = join(datasetRoot, 'guides')
    const outputRoot = join(root, 'out')
    const registryPath = join(root, 'registry.json')
    mkdirSync(guideRoot, { recursive: true })
    writeFileSync(join(datasetRoot, 'phrase.wav'), makeSineWav({ sampleRate: 8000, seconds: 0.5, hz: 440 }))
    writeFileSync(join(datasetRoot, 'phrase.txt'), '선명한 노래')
    writeFileSync(join(guideRoot, 'phrase.guide.wav'), makeSineWav({ sampleRate: 8000, seconds: 0.5, hz: 880 }))
    writeFileSync(registryPath, JSON.stringify(makeRegistry(datasetRoot, true), null, 2))

    const { summary, segments } = ingestNeuralDataset({
      registry: registryPath,
      dataset: 'mini-ko',
      out: outputRoot,
      targetRate: 16000,
      segmentSeconds: 1,
      minSegmentSeconds: 0.15,
    })

    expect(summary.files).toMatchObject({
      audioCount: 1,
      ignoredGuideAudioCount: 1,
      skippedCount: 0,
    })
    expect(summary.segments.count).toBe(1)
    expect(segments.map((segment) => segment.sourceRelative)).toEqual(['phrase.wav'])
    expect(readFileSync(join(outputRoot, 'segments.jsonl'), 'utf8')).not.toContain('.guide.wav')
  })

  it('extracts Korean lyrics from CSV note labels next to dataset WAVs', () => {
    const root = makeTempRoot()
    const datasetRoot = join(root, 'dataset')
    const outputRoot = join(root, 'out')
    const registryPath = join(root, 'registry.json')
    mkdirSync(datasetRoot, { recursive: true })
    writeFileSync(join(datasetRoot, 'guide-vocal.wav'), makeSineWav({ sampleRate: 8000, seconds: 0.5, hz: 440 }))
    writeFileSync(
      join(datasetRoot, 'guide-vocal.csv'),
      ['start,end,lyric,midi_num', '0.00,0.20,도,60', '0.20,0.40,히,64', ''].join('\n'),
    )
    writeFileSync(registryPath, JSON.stringify(makeRegistry(datasetRoot, true), null, 2))

    const { summary, segments } = ingestNeuralDataset({
      registry: registryPath,
      dataset: 'mini-ko',
      out: outputRoot,
      targetRate: 16000,
      segmentSeconds: 1,
      minSegmentSeconds: 0.15,
    })

    expect(summary.lyricCoverage).toMatchObject({ annotatedFiles: 1, hangulSyllableCount: 2 })
    expect(summary.lyricCoverage.uniqueHangulSyllables).toEqual(['도', '히'])
    expect(segments[0].annotationText).toBe('도 히')
  })

  it('extracts Korean lyrics from nested JSON note labels next to dataset WAVs', () => {
    const root = makeTempRoot()
    const datasetRoot = join(root, 'dataset')
    const outputRoot = join(root, 'out')
    const registryPath = join(root, 'registry.json')
    mkdirSync(datasetRoot, { recursive: true })
    writeFileSync(join(datasetRoot, 'nested.wav'), makeSineWav({ sampleRate: 8000, seconds: 0.5, hz: 440 }))
    writeFileSync(
      join(datasetRoot, 'nested.json'),
      JSON.stringify({
        notes: [
          { start: 0, end: 0.2, syllable: '가', midi_num: 60 },
          { start: 0.2, end: 0.4, syllable: '나', midi_num: 62 },
        ],
      }),
    )
    writeFileSync(registryPath, JSON.stringify(makeRegistry(datasetRoot, true), null, 2))

    const { summary, segments } = ingestNeuralDataset({
      registry: registryPath,
      dataset: 'mini-ko',
      out: outputRoot,
      targetRate: 16000,
      segmentSeconds: 1,
      minSegmentSeconds: 0.15,
    })

    expect(summary.lyricCoverage).toMatchObject({ annotatedFiles: 1, hangulSyllableCount: 2 })
    expect(summary.lyricCoverage.uniqueHangulSyllables).toEqual(['가', '나'])
    expect(segments[0].annotationText).toBe('가 나')
  })

  it('can limit ingestion to the first sorted audio files for quick dataset slices', () => {
    const root = makeTempRoot()
    const datasetRoot = join(root, 'dataset')
    const outputRoot = join(root, 'out')
    const registryPath = join(root, 'registry.json')
    mkdirSync(datasetRoot, { recursive: true })
    for (const id of ['b', 'a', 'c']) {
      writeFileSync(join(datasetRoot, `${id}.wav`), makeSineWav({ sampleRate: 8000, seconds: 0.25, hz: 440 }))
      writeFileSync(join(datasetRoot, `${id}.txt`), `노래${id}`)
    }
    writeFileSync(registryPath, JSON.stringify(makeRegistry(datasetRoot, true), null, 2))

    const { summary, segments } = ingestNeuralDataset({
      registry: registryPath,
      dataset: 'mini-ko',
      out: outputRoot,
      targetRate: 16000,
      segmentSeconds: 1,
      minSegmentSeconds: 0.15,
      limitFiles: 2,
    })

    expect(summary.files).toMatchObject({
      audioCount: 2,
      availableAudioCount: 3,
      limitFiles: 2,
    })
    expect(segments.map((segment) => segment.sourceRelative)).toEqual(['a.wav', 'b.wav'])
  })

  it('can restrict private singer ingest to takes accepted by a recording audit', () => {
    const root = makeTempRoot()
    const datasetRoot = join(root, 'dataset')
    const outputRoot = join(root, 'out')
    const registryPath = join(root, 'registry.json')
    const recordingAuditPath = join(root, 'recording-audit.json')
    mkdirSync(datasetRoot, { recursive: true })
    const goodWav = join(datasetRoot, 'good.wav')
    const badWav = join(datasetRoot, 'bad.wav')
    writeFileSync(goodWav, makeSineWav({ sampleRate: 8000, seconds: 0.5, hz: 440 }))
    writeFileSync(join(datasetRoot, 'good.txt'), '좋은 녹음')
    writeFileSync(badWav, makeSineWav({ sampleRate: 8000, seconds: 0.5, hz: 330 }))
    writeFileSync(join(datasetRoot, 'bad.txt'), '나쁜 녹음')
    writeFileSync(registryPath, JSON.stringify(makeRegistry(datasetRoot, true), null, 2))
    writeFileSync(
      recordingAuditPath,
      JSON.stringify(
        {
          version: 1,
          sessionId: 'private-audit-001',
          ok: false,
          results: [
            { id: 'good', ok: true, status: 'ready', wavPath: goodWav },
            { id: 'bad', ok: false, status: 'needs-review', wavPath: badWav, gates: { failed: ['guide-tick-leakage'] } },
          ],
        },
        null,
        2,
      ),
    )

    const { summary, segments } = ingestNeuralDataset({
      registry: registryPath,
      dataset: 'mini-ko',
      out: outputRoot,
      targetRate: 16000,
      segmentSeconds: 1,
      minSegmentSeconds: 0.15,
      recordingAudit: recordingAuditPath,
    })

    expect(summary.files).toMatchObject({
      audioCount: 1,
      availableAudioCount: 2,
      recordingAudit: {
        sessionId: 'private-audit-001',
        readyTakeCount: 1,
        readyWavCount: 1,
        eligibleAudioCount: 1,
        excludedAudioCount: 1,
        unmatchedReadyWavCount: 0,
      },
    })
    expect(segments.map((segment) => segment.sourceRelative)).toEqual(['good.wav'])
    expect(summary.lyricCoverage.uniqueHangulSyllables).toEqual(['녹', '은', '음', '좋'])
  })

  it('finds lyrics in sibling lyric directories for CSD-style dataset layouts', () => {
    const root = makeTempRoot()
    const datasetRoot = join(root, 'dataset')
    const outputRoot = join(root, 'out')
    const registryPath = join(root, 'registry.json')
    mkdirSync(join(datasetRoot, 'wav'), { recursive: true })
    mkdirSync(join(datasetRoot, 'lyric'), { recursive: true })
    writeFileSync(join(datasetRoot, 'wav', 'kr001a.wav'), makeSineWav({ sampleRate: 8000, seconds: 0.5, hz: 440 }))
    writeFileSync(join(datasetRoot, 'lyric', 'kr001a.txt'), '파란 하늘')
    writeFileSync(registryPath, JSON.stringify(makeRegistry(datasetRoot, true), null, 2))

    const { summary, segments } = ingestNeuralDataset({
      registry: registryPath,
      dataset: 'mini-ko',
      out: outputRoot,
      targetRate: 16000,
      segmentSeconds: 1,
      minSegmentSeconds: 0.15,
    })

    expect(summary.lyricCoverage).toMatchObject({ annotatedFiles: 1, hangulSyllableCount: 4 })
    expect(summary.lyricCoverage.uniqueHangulSyllables).toEqual(['늘', '란', '파', '하'])
    expect(segments[0]).toMatchObject({
      sourceRelative: join('wav', 'kr001a.wav'),
      annotationText: '파란 하늘',
    })
  })

  it('runs through the command-line entrypoint', () => {
    const root = makeTempRoot()
    const datasetRoot = join(root, 'dataset')
    const outputRoot = join(root, 'out')
    const registryPath = join(root, 'registry.json')
    mkdirSync(datasetRoot, { recursive: true })
    writeFileSync(join(datasetRoot, 'phrase.wav'), makeSineWav({ sampleRate: 8000, seconds: 0.5, hz: 330 }))
    writeFileSync(join(datasetRoot, 'phrase.txt'), '빛나는 꿈')
    writeFileSync(registryPath, JSON.stringify(makeRegistry(datasetRoot, true), null, 2))

    const stdout = execFileSync(
      process.execPath,
      [
        'scripts/ingest-neural-dataset.mjs',
        '--registry',
        registryPath,
        '--dataset',
        'mini-ko',
        '--out',
        outputRoot,
        '--target-rate',
        '16000',
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    const summary = JSON.parse(stdout)

    expect(summary.files).toMatchObject({ audioCount: 1, skippedCount: 0 })
    expect(summary.lyricCoverage.uniqueHangulSyllables).toEqual(['꿈', '나', '는', '빛'])
    expect(JSON.parse(readFileSync(join(outputRoot, 'summary.json'), 'utf8')).datasetId).toBe('mini-ko')
  })
})

function makeTempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'webuta-neural-ingest-'))
  tempRoots.push(root)
  return root
}

function makeRegistry(localPath, localTraining) {
  return {
    version: 1,
    datasets: [
      {
        id: 'mini-ko',
        name: 'Mini Korean Fixture',
        sourceUrl: null,
        localPath,
        licenseStatus: localTraining ? 'local-fixture-ok' : 'review-required',
        redistribution: 'private-test-fixture',
        modelPublishing: 'not-for-release',
        singerIdentity: 'synthetic-fixture',
        language: ['ko'],
        audioHours: null,
        annotationTypes: ['audio', 'lyrics'],
        allowedActions: {
          localTraining,
          publicModelRelease: false,
          publicAudioExamples: false,
        },
        reviewNotes: ['Synthetic test fixture.'],
      },
    ],
  }
}

function makeSineWav({ sampleRate, seconds, hz }) {
  const sampleCount = Math.round(sampleRate * seconds)
  const data = Buffer.alloc(sampleCount * 2)
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = Math.sin((index / sampleRate) * Math.PI * 2 * hz) * 0.5
    data.writeInt16LE(Math.round(sample * 32767), index * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}
