#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PRESETS = {
  'aihub-guide-vocal': {
    id: 'aihub-guide-vocal',
    name: 'AI Hub multi-timbre guide vocal data',
    sourceUrl: 'https://aihub.or.kr/aihubdata/data/view.do?dataSetSn=473',
    localPath: 'experiments/neural-singer/datasets/aihub-guide-vocal',
    licenseStatus: 'review-required-aihub-terms',
    redistribution: 'review-required-aihub-terms',
    modelPublishing: 'review-required-aihub-terms',
    singerIdentity: 'licensed-dataset',
    language: ['ko'],
    audioHours: null,
    annotationTypes: ['audio', 'midi', 'csv', 'json', 'note-timing', 'pitch'],
    reviewNotes: [
      'Primary dataset-first candidate for Korean SVS because the AI Hub page describes WAV, MIDI, CSV, note timing, and midi_num fields.',
      'Download requires AI Hub account/access review. Keep original archives and extracted audio under ignored local dataset paths.',
      'Do not enable public model release or public audio examples until AI Hub terms and generated-model rights are reviewed.',
    ],
  },
  'aihub-multispeaker-singing': {
    id: 'aihub-multispeaker-singing',
    name: 'AI Hub multi-speaker singing data',
    sourceUrl: 'https://aihub.or.kr/aihubdata/data/view.do?dataSetSn=465',
    localPath: 'experiments/neural-singer/datasets/aihub-multispeaker-singing',
    licenseStatus: 'review-required-aihub-terms',
    redistribution: 'review-required-aihub-terms',
    modelPublishing: 'review-required-aihub-terms',
    singerIdentity: 'licensed-dataset',
    language: ['ko'],
    audioHours: null,
    annotationTypes: ['audio', 'lyrics', 'metadata'],
    reviewNotes: [
      'AI Hub page lists this as Korean audio singing data built in 2021 and shows about 39.94 GB.',
      'The page indicates domestic applicant access requirements. Verify account eligibility and download terms before use.',
      'Useful as a broader Korean singing corpus after license and generated-model rights are reviewed.',
    ],
  },
}

const DEFAULT_MIN_PROVIDER_ARCHIVE_TOTAL_BYTES = 1024 ** 3

export function prepareLicensedDatasetIntake(options = {}) {
  const preset = PRESETS[options.preset ?? 'aihub-guide-vocal']
  if (!preset) {
    throw new Error(`Unknown dataset intake preset: ${options.preset}. Available: ${Object.keys(PRESETS).join(', ')}`)
  }
  const localPath = resolve(options.localPath ?? preset.localPath)
  const registryOut = resolve(options.registryOut ?? join(localPath, 'dataset-registry.local-template.json'))
  const allowLocalTraining = options.allowLocalTraining === true
  const dataset = {
    ...preset,
    localPath,
    licenseStatus: allowLocalTraining ? 'license-reviewed-local-training' : preset.licenseStatus,
    licenseReview: {
      requiresReview: true,
      templatePath: join(localPath, 'metadata', 'license-review.local.template.md'),
      reviewedPath: join(localPath, 'metadata', 'license-review.local.md'),
      requiredFields: ['Reviewer', 'Review date', 'Account/download approval confirmed', 'Local training allowed'],
    },
    qualityGates: {
      minAnnotatedRatio: 0.95,
      minProviderArchiveCount: 1,
      minProviderArchiveTotalBytes: DEFAULT_MIN_PROVIDER_ARCHIVE_TOTAL_BYTES,
    },
    allowedActions: {
      localTraining: allowLocalTraining,
      publicModelRelease: false,
      publicAudioExamples: false,
    },
  }
  const registry = {
    version: 1,
    notes: 'Local licensed dataset intake registry. Keep downloaded archives, private license notes, and extracted audio outside git.',
    datasets: [dataset],
  }

  mkdirSync(join(localPath, 'raw'), { recursive: true })
  mkdirSync(join(localPath, 'extracted'), { recursive: true })
  mkdirSync(join(localPath, 'metadata'), { recursive: true })
  mkdirSync(dirname(registryOut), { recursive: true })
  writeFileSync(join(localPath, 'README.md'), intakeReadme(dataset, registryOut))
  writeFileSync(join(localPath, 'metadata', 'license-review.local.template.md'), licenseReviewTemplate(dataset))
  writeFileSync(registryOut, `${JSON.stringify(registry, null, 2)}\n`)

  return {
    preset: dataset.id,
    localPath,
    registryOut,
    allowLocalTraining,
    sourceUrl: dataset.sourceUrl,
    nextCommands: [
      `npm run neural:inspect-intake -- --registry ${registryOut} --dataset ${dataset.id}`,
      `npm run neural:audit-provider-drop -- --registry ${registryOut} --dataset ${dataset.id} --production --report experiments/neural-singer/work/${dataset.id}-provider-drop.json`,
      `npm run neural:extract-dataset -- --registry ${registryOut} --dataset ${dataset.id} --report experiments/neural-singer/work/${dataset.id}-extract.json`,
      `npm run neural:materialize-sidecars -- --registry ${registryOut} --dataset ${dataset.id} --report experiments/neural-singer/work/${dataset.id}-sidecars.json`,
      `npm run neural:audit-datasets -- --registry ${registryOut} --dataset ${dataset.id}`,
      `npm run neural:ingest-dataset -- --registry ${registryOut} --dataset ${dataset.id} --out experiments/neural-singer/work/${dataset.id}-ingest`,
    ],
  }
}

function intakeReadme(dataset, registryOut) {
  return [
    `# ${dataset.name} Intake`,
    '',
    'This folder is an ignored local intake area for a licensed Korean singing dataset.',
    '',
    `Source: ${dataset.sourceUrl}`,
    `Dataset id: ${dataset.id}`,
    '',
    '## Manual Intake',
    '',
    '1. Log in to the provider site and complete any access/download request.',
    '2. Save original archives under `raw/` without committing them.',
    '3. Run `npm run neural:audit-provider-drop` before extraction to confirm the raw drop is not just a tiny sample or placeholder archive and to record SHA-256 hashes for provenance.',
    '4. Extract working audio/labels under `extracted/` with `npm run neural:extract-dataset`, or manually if the provider uses an unsupported archive type.',
    '5. Copy `metadata/license-review.local.template.md` to `metadata/license-review.local.md` and fill the review fields.',
    '6. Only after rights review, copy the registry template and set `allowedActions.localTraining=true`.',
    '7. Keep WAV files paired with same-stem `.txt`, `.lab`, `.json`, or `.csv` lyrics/labels; sibling `lyric/`, `csv/`, `json/`, and `metadata/` folders are recognized.',
    '8. Run the intake inspector before enabling training so archives, extracted audio, note metadata, and annotation pairing are visible in one report.',
    '',
    '## Verification',
    '',
    '```sh',
    `npm run neural:inspect-intake -- --registry ${relativePath(registryOut)} --dataset ${dataset.id}`,
    '',
    '# After provider archives are present under raw/:',
    `npm run neural:audit-provider-drop -- --registry ${relativePath(registryOut)} --dataset ${dataset.id} --production --report experiments/neural-singer/work/${dataset.id}-provider-drop.json`,
    '',
    `npm run neural:extract-dataset -- --registry ${relativePath(registryOut)} --dataset ${dataset.id} --report experiments/neural-singer/work/${dataset.id}-extract.json`,
    '',
    '# Only when inspect-intake reports global CSV/JSON note metadata without same-stem pairing:',
    `npm run neural:materialize-sidecars -- --registry ${relativePath(registryOut)} --dataset ${dataset.id} --report experiments/neural-singer/work/${dataset.id}-sidecars.json`,
    '',
    `npm run neural:audit-datasets -- --registry ${relativePath(registryOut)} --dataset ${dataset.id}`,
    '',
    `npm run neural:ingest-dataset -- --registry ${relativePath(registryOut)} --dataset ${dataset.id} --out experiments/neural-singer/work/${dataset.id}-ingest`,
    '```',
    '',
    'Do not publish model checkpoints, generated examples, or public demos until model-publishing terms are reviewed.',
    '',
  ].join('\n')
}

function licenseReviewTemplate(dataset) {
  return [
    `# License Review: ${dataset.name}`,
    '',
    `Source URL: ${dataset.sourceUrl}`,
    `Dataset id: ${dataset.id}`,
    '',
    '## Fill Before Training',
    '',
    '- Reviewer:',
    '- Review date:',
    '- Account/download approval confirmed: no',
    '- Local training allowed: no',
    '- Public model release allowed: no',
    '- Public audio examples allowed: no',
    '- Commercial use allowed: no',
    '- Required attribution:',
    '- Notes:',
    '',
  ].join('\n')
}

function relativePath(path) {
  return path.startsWith(process.cwd()) ? path.slice(process.cwd().length + 1) : path
}

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--preset') {
      parsed.preset = argv[++index]
    } else if (arg === '--local-path') {
      parsed.localPath = argv[++index]
    } else if (arg === '--registry-out') {
      parsed.registryOut = argv[++index]
    } else if (arg === '--allow-local-training') {
      parsed.allowLocalTraining = true
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        [
          'Usage: node scripts/prepare-licensed-dataset-intake.mjs [options]',
          '',
          'Options:',
          `  --preset id              Dataset preset: ${Object.keys(PRESETS).join(', ')}`,
          '  --local-path path        Local ignored dataset intake directory',
          '  --registry-out path      Output local registry template',
          '  --allow-local-training   Mark registry locally trainable after license review',
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
    const result = prepareLicensedDatasetIntake(parseArgs(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
