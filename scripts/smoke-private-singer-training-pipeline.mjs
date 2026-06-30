#!/usr/bin/env node

import { dirname, join, resolve } from 'node:path'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { preparePrivateSingerRecordingPack } from './prepare-private-singer-recording-pack.mjs'
import { preparePrivateSingerGuideTracks } from './prepare-private-singer-guide-tracks.mjs'
import { auditPrivateSingerRecordingTakes } from './audit-private-singer-recording-takes.mjs'
import { auditNeuralDatasets } from './audit-neural-datasets.mjs'
import { ingestNeuralDataset } from './ingest-neural-dataset.mjs'
import { auditNeuralTrainingReadiness } from './audit-neural-training-readiness.mjs'
import { prepareOpenVpiSeed } from './prepare-openvpi-seed.mjs'

const DEFAULT_SAMPLE_RATE = 44100

export async function smokePrivateSingerTrainingPipeline(options = {}) {
  const tempRoot = mkdtempSync(join(tmpdir(), 'webuta-training-pipeline-smoke-'))
  try {
    const packDir = resolve(options.packDir ?? join(tempRoot, 'pack'))
    const registryPath = resolve(options.registry ?? join(tempRoot, 'registry.local.json'))
    const workDir = resolve(options.workDir ?? join(tempRoot, 'work'))
    const takeLimit = positiveInteger(options.takeLimit, 4)
    const targetMinutes = positiveNumber(options.targetMinutes, 0.5)
    const sampleRate = positiveInteger(options.sampleRate, DEFAULT_SAMPLE_RATE)

    const pack = preparePrivateSingerRecordingPack({
      out: packDir,
      registryOut: registryPath,
      targetMinutes,
      sessionId: options.sessionId ?? 'pipe-001',
      singerId: options.singerId ?? 'pipeline-smoke-singer',
      allowLocalTraining: true,
    })
    writeSyntheticSignedConsent(packDir)
    const session = JSON.parse(readFileSync(join(packDir, 'recording-session.json'), 'utf8'))
    const selectedTakes = session.takes.slice(0, Math.min(takeLimit, session.takes.length))
    if (selectedTakes.length === 0) {
      throw new Error('Generated private singer pack has no takes.')
    }

    const guide = preparePrivateSingerGuideTracks({
      packDir,
      takes: selectedTakes.map((take) => take.id).join(','),
      sampleRate: 22050,
      countInBeats: 2,
    })
    const syntheticWavs = writeSyntheticDryVocals({ packDir, takes: selectedTakes, sampleRate })
    const takeIds = selectedTakes.map((take) => take.id).join(',')
    const recordingReportPath = join(workDir, 'recording-audit.json')
    const reviewCsvPath = join(workDir, 'recording-review.csv')
    const recordingAudit = auditPrivateSingerRecordingTakes({
      packDir,
      takes: takeIds,
      report: recordingReportPath,
      reviewCsv: reviewCsvPath,
      durationToleranceSeconds: 0.2,
      maxMedianAbsCents: 80,
      maxMedianOnsetLagSeconds: 0.08,
      maxMissingOnsetRatio: 0.05,
    })
    if (!recordingAudit.ok) {
      throw new Error(`Synthetic recording audit did not pass: ${JSON.stringify(recordingAudit.totals)}`)
    }

    const datasetAudit = auditNeuralDatasets({
      registry: registryPath,
      minLocalTrainingMinutes: 0.25,
    })
    if (!datasetAudit.ok) {
      throw new Error(`Synthetic dataset audit did not pass: ${JSON.stringify(datasetAudit.datasets?.[0]?.problems ?? datasetAudit.problems)}`)
    }

    const ingestDir = join(workDir, 'ingest')
    const ingest = ingestNeuralDataset({
      registry: registryPath,
      dataset: 'original-private-singer',
      out: ingestDir,
      recordingAudit: recordingReportPath,
      targetRate: sampleRate,
      segmentSeconds: 8,
      minSegmentSeconds: 0.15,
    })
    if (ingest.summary.segments.count < selectedTakes.length) {
      throw new Error(`Expected at least ${selectedTakes.length} ingest segments, got ${ingest.summary.segments.count}.`)
    }
    if (ingest.summary.files.ignoredGuideAudioCount !== selectedTakes.length) {
      throw new Error(`Expected ${selectedTakes.length} ignored guide WAVs, got ${ingest.summary.files.ignoredGuideAudioCount}.`)
    }

    const readinessPath = join(workDir, 'readiness.json')
    const readiness = auditNeuralTrainingReadiness({
      ingestDir,
      registry: registryPath,
      minMinutes: 0.25,
      minUniquePhonemes: 4,
      minMeanVoicedRatio: 0.25,
      maxMeanSilenceRatio: 0.7,
      report: readinessPath,
    })
    if (!readiness.ok) {
      throw new Error(`Synthetic readiness audit did not pass: ${JSON.stringify(readiness.gates.filter((gate) => !gate.passed))}`)
    }

    const openVpiDir = join(workDir, 'openvpi-seed')
    const openVpi = prepareOpenVpiSeed({
      ingestDir,
      out: openVpiDir,
      copyAudio: true,
    })
    if (openVpi.segmentCount !== ingest.summary.segments.count) {
      throw new Error(`OpenVPI segment count mismatch: ${openVpi.segmentCount} vs ${ingest.summary.segments.count}`)
    }

    const report = {
      ok: true,
      mode: 'synthetic-dry-vocal-pipeline',
      packDir,
      registryPath,
      workDir,
      generatedPack: {
        takeCount: pack.totals.takeCount,
        selectedTakeCount: selectedTakes.length,
        guideCount: guide.totals.takeCount,
      },
      syntheticWavs,
      gates: {
        recordingAudit: {
          ok: recordingAudit.ok,
          totals: recordingAudit.totals,
          reportPath: recordingReportPath,
          reviewCsvPath,
        },
        datasetAudit: {
          ok: datasetAudit.ok,
          fileCount: datasetAudit.datasets[0].audio.fileCount,
          ignoredGuideAudioCount: datasetAudit.datasets[0].audio.ignoredGuideAudioCount,
          knownDurationSeconds: datasetAudit.datasets[0].audio.knownDurationSeconds,
        },
        ingest: {
          audioCount: ingest.summary.files.audioCount,
          recordingAuditEligibleCount: ingest.summary.files.recordingAudit?.eligibleAudioCount ?? null,
          recordingAuditExcludedCount: ingest.summary.files.recordingAudit?.excludedAudioCount ?? null,
          ignoredGuideAudioCount: ingest.summary.files.ignoredGuideAudioCount,
          segmentCount: ingest.summary.segments.count,
          totalDurationSeconds: ingest.summary.segments.totalDurationSeconds,
          uniquePhonemes: ingest.summary.lyricCoverage.uniquePhonemes,
        },
        readiness: {
          ok: readiness.ok,
          metrics: readiness.metrics,
          reportPath: readinessPath,
        },
        openVpi: {
          segmentCount: openVpi.segmentCount,
          copiedAudio: openVpi.copiedAudio,
          outputDir: openVpi.outputDir,
        },
      },
      checks: [
        'private singer capture pack generated',
        'headphone guides generated',
        'synthetic dry vocal WAVs written to wavs/',
        'recording audit passed with F0 and onset diagnostics',
        'dataset ingest used only recording-audit-ready WAVs',
        'dataset audit passed and ignored guide WAVs',
        'dataset ingest created training segments',
        'training readiness smoke gates passed',
        'OpenVPI pre-alignment seed corpus generated',
      ],
      note:
        'This smoke uses synthetic dry vocal WAVs to verify the pipeline shape. It is not evidence of production voice quality or publishable model rights.',
    }
    if (options.out) {
      writeJson(resolve(options.out), report)
    }
    return report
  } finally {
    if (!options.keepTemp) {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  }
}

function writeSyntheticDryVocals({ packDir, takes, sampleRate }) {
  return takes.map((take) => {
    const request = JSON.parse(readFileSync(resolve(packDir, take.neuralRequestPath), 'utf8'))
    const samples = syntheticSamplesForRequest(request, sampleRate)
    const wavPath = resolve(packDir, take.wavPath)
    mkdirSync(dirname(wavPath), { recursive: true })
    writeFileSync(wavPath, encodePcm16Wav(samples, sampleRate))
    return {
      id: take.id,
      wavPath,
      lyric: take.lyric,
      durationSeconds: samples.length / sampleRate,
      sampleRate,
    }
  })
}

function writeSyntheticSignedConsent(packDir) {
  writeFileSync(
    join(packDir, 'consent-form.signed.local.md'),
    [
      '# Synthetic Pipeline Smoke Consent',
      '',
      'This fixture exists only in a temporary smoke-test directory.',
      '',
      'Singer signature: Synthetic Fixture',
      `Date: ${new Date().toISOString().slice(0, 10)}`,
      'Reviewer: WebUtau Pipeline Smoke',
      '',
    ].join('\n'),
  )
}

function syntheticSamplesForRequest(request, sampleRate) {
  const durationSeconds = request.notes.reduce(
    (max, note) => Math.max(max, Number(note.startSeconds) + Number(note.durationSeconds)),
    0,
  )
  const samples = new Float32Array(Math.ceil(durationSeconds * sampleRate))
  for (const note of request.notes.filter((item) => item.kind === 'note')) {
    const start = Math.max(0, Math.round(Number(note.startSeconds) * sampleRate))
    const length = Math.max(1, Math.round(Number(note.durationSeconds) * sampleRate))
    const hz = Number(note.targetHz)
    const attack = Math.max(1, Math.round(Math.min(0.025, Number(note.durationSeconds) * 0.2) * sampleRate))
    const release = Math.max(1, Math.round(Math.min(0.035, Number(note.durationSeconds) * 0.2) * sampleRate))
    for (let index = 0; index < length && start + index < samples.length; index += 1) {
      const t = index / sampleRate
      const fadeIn = Math.min(1, index / attack)
      const fadeOut = Math.min(1, (length - index) / release)
      const envelope = Math.max(0, Math.min(fadeIn, fadeOut))
      const vibratoCents = Math.sin(t * Math.PI * 2 * 5.2) * 5
      const voicedHz = hz * 2 ** (vibratoCents / 1200)
      const tone =
        Math.sin(Math.PI * 2 * voicedHz * t) * 0.2 +
        Math.sin(Math.PI * 2 * voicedHz * 2 * t) * 0.035 +
        Math.sin(Math.PI * 2 * voicedHz * 3 * t) * 0.015
      const onsetLength = Math.round(0.018 * sampleRate)
      const onsetBurst = index < onsetLength ? pseudoNoise(start + index) * (1 - index / Math.max(1, onsetLength)) * 0.035 : 0
      samples[start + index] += tone * envelope + onsetBurst
    }
  }
  return samples
}

function pseudoNoise(seed) {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453
  return (value - Math.floor(value)) * 2 - 1
}

function encodePcm16Wav(samples, sampleRate) {
  const data = Buffer.alloc(samples.length * 2)
  for (let index = 0; index < samples.length; index += 1) {
    data.writeInt16LE(Math.round(clamp(samples[index], -1, 1) * 32767), index * 2)
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

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function positiveNumber(value, fallback) {
  return Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback
}

function positiveInteger(value, fallback) {
  return Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : fallback
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--out') {
      parsed.out = argv[++index]
    } else if (arg === '--work-dir') {
      parsed.workDir = argv[++index]
    } else if (arg === '--pack-dir') {
      parsed.packDir = argv[++index]
    } else if (arg === '--registry') {
      parsed.registry = argv[++index]
    } else if (arg === '--take-limit') {
      parsed.takeLimit = Number(argv[++index])
    } else if (arg === '--target-minutes') {
      parsed.targetMinutes = Number(argv[++index])
    } else if (arg === '--sample-rate') {
      parsed.sampleRate = Number(argv[++index])
    } else if (arg === '--session-id') {
      parsed.sessionId = argv[++index]
    } else if (arg === '--singer-id') {
      parsed.singerId = argv[++index]
    } else if (arg === '--keep-temp') {
      parsed.keepTemp = true
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        [
          'Usage: node scripts/smoke-private-singer-training-pipeline.mjs [options]',
          '',
          'Options:',
          '  --out path             Write JSON smoke report to path',
          '  --work-dir path        Keep generated work artifacts under this directory',
          '  --pack-dir path        Generate/use the smoke pack at this path',
          '  --registry path        Registry path for the smoke pack',
          '  --take-limit n         Number of generated takes to synthesize, default 4',
          '  --target-minutes n     Generated pack duration target, default 0.5',
          `  --sample-rate n        Synthetic WAV sample rate, default ${DEFAULT_SAMPLE_RATE}`,
          '  --session-id id        Generated smoke session id',
          '  --singer-id id         Generated smoke singer id',
          '  --keep-temp            Keep temporary pack/work folders for inspection',
          '',
        ].join('\n'),
      )
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return parsed
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await smokePrivateSingerTrainingPipeline(parseArgs(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
