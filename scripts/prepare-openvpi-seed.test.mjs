import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ingestNeuralDataset } from './ingest-neural-dataset.mjs'
import { prepareOpenVpiSeed } from './prepare-openvpi-seed.mjs'

const tempRoots = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('OpenVPI seed preparation', () => {
  it('converts WebUtau ingestion metadata into a pre-alignment seed corpus', () => {
    const { ingestDir, root } = createIngestFixture()
    const out = join(root, 'openvpi-seed')
    const result = prepareOpenVpiSeed({ ingestDir, out, copyAudio: true })

    expect(result).toMatchObject({
      copiedAudio: true,
      segmentCount: 2,
    })
    expect(readFileSync(join(out, 'raw', 'transcriptions.csv'), 'utf8')).toBe(
      ['name,text', 'phrase-001,강 남 밤 하 늘', 'phrase-002,강 남 밤 하 늘', ''].join('\n'),
    )
    expect(readFileSync(join(out, 'raw', 'wavs', 'phrase-001.lab'), 'utf8')).toBe('강 남 밤 하 늘\n')
    expect(readFileSync(join(out, 'raw', 'wavs', 'phrase-001.wav')).toString('ascii', 0, 4)).toBe('RIFF')
    const manifest = JSON.parse(readFileSync(join(out, 'webuta-openvpi-seed.manifest.json'), 'utf8'))
    expect(manifest).toMatchObject({ datasetId: 'mini-ko', copiedAudio: true })
    expect(manifest.segments).toHaveLength(2)
    expect(manifest.segments[0]).toMatchObject({ name: 'phrase-001', text: '강 남 밤 하 늘' })
  })

  it('runs through the command-line entrypoint', () => {
    const { ingestDir, root } = createIngestFixture()
    const out = join(root, 'cli-openvpi-seed')
    const stdout = execFileSync(
      process.execPath,
      ['scripts/prepare-openvpi-seed.mjs', '--ingest-dir', ingestDir, '--out', out, '--copy-audio'],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    const result = JSON.parse(stdout)

    expect(result.segmentCount).toBe(2)
    expect(readFileSync(join(out, 'README.md'), 'utf8')).toContain('pre-alignment corpus')
  })

  it('keeps duplicate segment basenames from overwriting each other', () => {
    const root = mkdtempSync(join(tmpdir(), 'webuta-openvpi-duplicates-'))
    tempRoots.push(root)
    const ingestDir = join(root, 'ingest')
    const out = join(root, 'seed')
    mkdirSync(ingestDir, { recursive: true })
    writeFileSync(
      join(ingestDir, 'summary.json'),
      JSON.stringify(
        {
          datasetId: 'duplicate-ko',
          datasetRoot: join(root, 'dataset'),
        },
        null,
        2,
      ),
    )
    writeFileSync(
      join(ingestDir, 'segments.jsonl'),
      [
        JSON.stringify(segmentFixture({ id: '0000-001', sourceRelative: 'a/0000.wav' })),
        JSON.stringify(segmentFixture({ id: '0000-001', sourceRelative: 'b/0000.wav' })),
        JSON.stringify(segmentFixture({ id: '0000-001', sourceRelative: 'c/0000.wav' })),
        '',
      ].join('\n'),
    )

    const result = prepareOpenVpiSeed({ ingestDir, out })

    expect(result.segmentCount).toBe(3)
    expect(readFileSync(join(out, 'raw', 'transcriptions.csv'), 'utf8')).toBe(
      ['name,text', '0000-001,가 나', '0000-001-0002,가 나', '0000-001-0003,가 나', ''].join('\n'),
    )
    expect(readFileSync(join(out, 'raw', 'wavs', '0000-001.lab'), 'utf8')).toBe('가 나\n')
    expect(readFileSync(join(out, 'raw', 'wavs', '0000-001-0002.lab'), 'utf8')).toBe('가 나\n')
    expect(readFileSync(join(out, 'raw', 'wavs', '0000-001-0003.lab'), 'utf8')).toBe('가 나\n')
  })

  it('drops bracketed pause labels instead of splitting them into letters', () => {
    const root = mkdtempSync(join(tmpdir(), 'webuta-openvpi-pauses-'))
    tempRoots.push(root)
    const ingestDir = join(root, 'ingest')
    const out = join(root, 'seed')
    mkdirSync(ingestDir, { recursive: true })
    writeFileSync(join(ingestDir, 'summary.json'), JSON.stringify({ datasetId: 'pause-ko', datasetRoot: join(root, 'dataset') }))
    writeFileSync(
      join(ingestDir, 'segments.jsonl'),
      `${JSON.stringify({
        ...segmentFixture({ id: 'pause-001', sourceRelative: 'pause.wav' }),
        annotationText: '가<AP>나 <SP>다',
      })}\n`,
    )

    prepareOpenVpiSeed({ ingestDir, out })

    expect(readFileSync(join(out, 'raw', 'transcriptions.csv'), 'utf8')).toBe(['name,text', 'pause-001,가 나 다', ''].join('\n'))
    expect(readFileSync(join(out, 'raw', 'wavs', 'pause-001.lab'), 'utf8')).toBe('가 나 다\n')
  })
})

function createIngestFixture() {
  const root = mkdtempSync(join(tmpdir(), 'webuta-openvpi-seed-'))
  tempRoots.push(root)
  const datasetRoot = join(root, 'dataset')
  const ingestDir = join(root, 'ingest')
  const registryPath = join(root, 'registry.json')
  mkdirSync(datasetRoot, { recursive: true })
  writeFileSync(join(datasetRoot, 'phrase.wav'), makeSineWav({ sampleRate: 8000, seconds: 0.8, hz: 440 }))
  writeFileSync(join(datasetRoot, 'phrase.txt'), '강남 밤하늘')
  writeFileSync(registryPath, JSON.stringify(makeRegistry(datasetRoot), null, 2))
  ingestNeuralDataset({
    registry: registryPath,
    dataset: 'mini-ko',
    out: ingestDir,
    targetRate: 16000,
    segmentSeconds: 0.4,
    minSegmentSeconds: 0.15,
  })
  return { root, ingestDir }
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
        annotationTypes: ['audio', 'lyrics'],
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

function segmentFixture({ id, sourceRelative }) {
  return {
    id,
    sourceRelative,
    startSeconds: 0,
    durationSeconds: 1,
    targetSampleRate: 44100,
    annotationText: '가나',
    stats: {},
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
