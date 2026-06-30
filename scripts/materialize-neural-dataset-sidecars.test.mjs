import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ingestNeuralDataset } from './ingest-neural-dataset.mjs'
import { materializeNeuralDatasetSidecars } from './materialize-neural-dataset-sidecars.mjs'

const tempRoots = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('neural dataset sidecar materialization', () => {
  it('turns global CSV note metadata into ingest-compatible sibling sidecars', () => {
    const root = makeTempRoot()
    const datasetRoot = join(root, 'dataset')
    const wavRoot = join(datasetRoot, 'extracted', 'wav')
    const metadataRoot = join(datasetRoot, 'metadata')
    const registryPath = join(root, 'registry.json')
    mkdirSync(wavRoot, { recursive: true })
    mkdirSync(metadataRoot, { recursive: true })
    writeFileSync(join(wavRoot, 'song-a.wav'), makeSineWav({ sampleRate: 8000, seconds: 0.6, hz: 440 }))
    writeFileSync(
      join(metadataRoot, 'notes.csv'),
      ['audio,start,end,lyric,midi_num', 'song-a.wav,0.0,0.2,도,60', 'song-a.wav,0.2,0.4,히,64', ''].join('\n'),
    )
    writeFileSync(registryPath, JSON.stringify(makeRegistry(datasetRoot), null, 2))

    const report = materializeNeuralDatasetSidecars({
      registry: registryPath,
      dataset: 'mini-ko',
      overwrite: true,
    })

    const sidecarPath = join(datasetRoot, 'extracted', 'metadata', 'song-a.csv')
    expect(report.sidecars).toMatchObject({
      writtenCount: 1,
      plannedCount: 1,
    })
    expect(readFileSync(sidecarPath, 'utf8')).toContain('도')
    expect(readFileSync(sidecarPath, 'utf8')).toContain('source_metadata')

    const { summary, segments } = ingestNeuralDataset({
      registry: registryPath,
      dataset: 'mini-ko',
      out: join(root, 'ingest'),
      targetRate: 16000,
      segmentSeconds: 1,
      minSegmentSeconds: 0.15,
    })

    expect(summary.lyricCoverage).toMatchObject({ annotatedFiles: 1, hangulSyllableCount: 2 })
    expect(summary.lyricCoverage.uniqueHangulSyllables).toEqual(['도', '히'])
    expect(segments[0].annotationText).toBe('도 히')
  })

  it('propagates parent audio references through nested JSON note arrays', () => {
    const root = makeTempRoot()
    const datasetRoot = join(root, 'dataset')
    const wavRoot = join(datasetRoot, 'extracted', 'wav')
    const metadataRoot = join(datasetRoot, 'metadata')
    mkdirSync(wavRoot, { recursive: true })
    mkdirSync(metadataRoot, { recursive: true })
    writeFileSync(join(wavRoot, 'nested.wav'), makeSineWav({ sampleRate: 8000, seconds: 0.6, hz: 330 }))
    writeFileSync(
      join(metadataRoot, 'nested-notes.json'),
      JSON.stringify({
        songs: [
          {
            audio: 'nested.wav',
            notes: [
              { start: 0, duration: 0.2, syllable: '가', midi_num: 60 },
              { start: 0.2, duration: 0.2, syllable: '나', midi_num: 62 },
            ],
          },
        ],
      }),
    )

    const report = materializeNeuralDatasetSidecars({
      localPath: datasetRoot,
      overwrite: true,
    })

    expect(report.rows).toMatchObject({
      matchedAudioCount: 1,
      matchedRowCount: 2,
      unmatchedCount: 0,
      ambiguousCount: 0,
    })
    expect(readFileSync(join(datasetRoot, 'extracted', 'metadata', 'nested.csv'), 'utf8')).toContain('가')
  })

  it('does not choose between duplicate audio basenames', () => {
    const root = makeTempRoot()
    const datasetRoot = join(root, 'dataset')
    mkdirSync(join(datasetRoot, 'a'), { recursive: true })
    mkdirSync(join(datasetRoot, 'b'), { recursive: true })
    mkdirSync(join(datasetRoot, 'metadata'), { recursive: true })
    writeFileSync(join(datasetRoot, 'a', 'same.wav'), makeSineWav({ sampleRate: 8000, seconds: 0.2, hz: 220 }))
    writeFileSync(join(datasetRoot, 'b', 'same.wav'), makeSineWav({ sampleRate: 8000, seconds: 0.2, hz: 330 }))
    writeFileSync(join(datasetRoot, 'metadata', 'notes.csv'), 'audio,lyric,midi_num\nsame.wav,라,60\n')

    const report = materializeNeuralDatasetSidecars({
      localPath: datasetRoot,
      dryRun: true,
    })

    expect(report.sidecars.plannedCount).toBe(0)
    expect(report.rows).toMatchObject({
      matchedAudioCount: 0,
      ambiguousCount: 1,
    })
    expect(report.rows.ambiguousSamples[0].candidates).toEqual(['a/same.wav', 'b/same.wav'])
  })

  it('skips existing sidecars unless overwrite is requested and works from the CLI', () => {
    const root = makeTempRoot()
    const datasetRoot = join(root, 'dataset')
    const wavRoot = join(datasetRoot, 'extracted', 'wav')
    const metadataRoot = join(datasetRoot, 'metadata')
    const reportPath = join(root, 'report.json')
    mkdirSync(wavRoot, { recursive: true })
    mkdirSync(metadataRoot, { recursive: true })
    mkdirSync(join(datasetRoot, 'extracted', 'metadata'), { recursive: true })
    writeFileSync(join(wavRoot, 'song-b.wav'), makeSineWav({ sampleRate: 8000, seconds: 0.3, hz: 440 }))
    writeFileSync(join(metadataRoot, 'notes.csv'), 'audio,lyric,midi_num\nsong-b.wav,미,60\n')
    writeFileSync(join(datasetRoot, 'extracted', 'metadata', 'song-b.csv'), 'start,end,duration,lyric,midi_num,pitch_hz,source_metadata,source_row\n0,0.1,,기,60,,old,1\n')

    const stdout = execFileSync(
      process.execPath,
      ['scripts/materialize-neural-dataset-sidecars.mjs', '--local-path', datasetRoot, '--report', reportPath],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    const report = JSON.parse(stdout)

    expect(report.sidecars).toMatchObject({
      plannedCount: 1,
      writtenCount: 0,
      skippedExistingCount: 1,
    })
    expect(readFileSync(join(datasetRoot, 'extracted', 'metadata', 'song-b.csv'), 'utf8')).toContain('기')
    expect(JSON.parse(readFileSync(reportPath, 'utf8')).sidecars.skippedExistingCount).toBe(1)
    expect(existsSync(reportPath)).toBe(true)
  })
})

function makeTempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'webuta-sidecar-materialize-'))
  tempRoots.push(root)
  return root
}

function makeRegistry(localPath) {
  return {
    version: 1,
    datasets: [
      {
        id: 'mini-ko',
        name: 'Mini Korean Fixture',
        sourceUrl: null,
        localPath,
        licenseStatus: 'local-fixture-ok',
        redistribution: 'private-test-fixture',
        modelPublishing: 'not-for-release',
        singerIdentity: 'synthetic-fixture',
        language: ['ko'],
        audioHours: null,
        annotationTypes: ['audio', 'lyrics', 'csv', 'json', 'note-timing', 'pitch'],
        allowedActions: {
          localTraining: true,
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
