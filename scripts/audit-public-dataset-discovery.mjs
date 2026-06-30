#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DEFAULT_PUBLIC_DATASET_CANDIDATES = [
  candidate({
    id: 'csd-korean-research-baseline',
    label: "CSD Children's Song Dataset Korean subset",
    manifest: 'experiments/neural-singer/datasets/csd/csd.manifest.json',
    kind: 'singing',
    role: 'research-training-baseline',
    minPresentFiles: 1,
    expectedLicense: 'cc-by-nc-sa-4.0-research-only',
    productionEligible: false,
    blocker: 'Noncommercial ShareAlike license; use only as research/noncommercial SVS baseline unless separately reviewed.',
  }),
  candidate({
    id: 'gtsinger-korean-research-baseline',
    label: 'GTSinger Korean subset',
    manifest: 'experiments/neural-singer/datasets/gtsinger-korean/gtsinger-korean.manifest.json',
    kind: 'singing',
    role: 'research-training-baseline',
    minPresentFiles: 12_000,
    expectedLicense: 'cc-by-nc-sa-4.0-research-only',
    productionEligible: false,
    blocker: 'Noncommercial ShareAlike license; use as local research quality baseline, not public product-release evidence.',
  }),
  candidate({
    id: 'kss-korean-speech-pronunciation-aux',
    label: 'KSS Korean speech corpus',
    manifest: 'experiments/neural-singer/datasets/kss-korean-speech/kss.manifest.json',
    kind: 'speech',
    role: 'pronunciation-auxiliary',
    minPresentFiles: 1,
    expectedLicense: 'cc-by-nc-sa-4.0-research-only',
    productionEligible: false,
    blocker: 'Speech-only and noncommercial; useful for pronunciation/front-end experiments only.',
  }),
  candidate({
    id: 'zeroth-korean-speech-aux',
    label: 'OpenSLR Zeroth-Korean speech corpus',
    manifest: 'experiments/neural-singer/datasets/zeroth-korean-speech/zeroth-korean.manifest.json',
    kind: 'speech',
    role: 'pronunciation-asr-auxiliary',
    minPresentFiles: 1,
    expectedLicense: 'cc-by-4.0-speech-auxiliary',
    productionEligible: false,
    blocker: 'Speech-only; useful for Korean pronunciation/ASR checks, not singing model completion.',
  }),
  candidate({
    id: 'seoul-corpus-speech-aux',
    label: 'OpenSLR Seoul Corpus',
    manifest: 'experiments/neural-singer/datasets/seoul-corpus-speech/seoul-corpus.manifest.json',
    kind: 'speech',
    role: 'phonetic-label-auxiliary',
    minPresentFiles: 3,
    expectedLicense: 'cc-by-nc-2.0-research-only',
    productionEligible: false,
    blocker: 'Speech-only and noncommercial; use as auxiliary phonetic-label evidence only.',
  }),
  candidate({
    id: 'pansori-tedxkr-reference-only',
    label: 'OpenSLR Pansori TEDxKR',
    manifest: 'experiments/neural-singer/datasets/pansori-tedxkr-reference/pansori-tedxkr.manifest.json',
    kind: 'speech',
    role: 'reference-only',
    minPresentFiles: 1,
    expectedLicense: 'cc-by-nc-nd-4.0-reference-only',
    productionEligible: false,
    blocker: 'NoDerivatives license and speech content; keep reference-only without separate rights.',
  }),
  candidate({
    id: 'deeply-korean-read-reference-only',
    label: 'OpenSLR Deeply Korean read speech',
    manifest: 'experiments/neural-singer/datasets/deeply-korean-read-reference/deeply-korean-read.manifest.json',
    kind: 'speech',
    role: 'reference-only',
    minPresentFiles: 1,
    expectedLicense: 'cc-by-nc-nd-4.0-reference-only',
    productionEligible: false,
    blocker: 'NoDerivatives license and speech content; keep reference-only without separate rights.',
  }),
  candidate({
    id: 'deeply-parent-child-vocal-reference-only',
    label: 'OpenSLR parent-child vocal interaction',
    manifest:
      'experiments/neural-singer/datasets/deeply-parent-child-vocal-reference/deeply-parent-child-vocal.manifest.json',
    kind: 'vocal-interaction',
    role: 'reference-only',
    minPresentFiles: 1,
    expectedLicense: 'cc-by-nc-nd-4.0-reference-only',
    productionEligible: false,
    blocker: 'NoDerivatives license; singing labels are discovery evidence only, not training permission.',
  }),
]

export function auditPublicDatasetDiscovery(options = {}) {
  const candidates = options.candidates ?? DEFAULT_PUBLIC_DATASET_CANDIDATES
  const audited = candidates.map(auditCandidate)
  const missing = audited.filter((item) => !item.present)
  const insufficient = audited.filter((item) => item.present && !item.meetsLocalEvidenceGate)
  const licenseMismatches = audited.filter((item) => item.present && item.expectedLicense && item.licenseStatus !== item.expectedLicense)
  const productionReady = audited.filter((item) => item.productionEligible && item.present && item.meetsLocalEvidenceGate)
  const researchSinging = audited.filter((item) => item.kind === 'singing' && item.role.includes('research') && item.meetsLocalEvidenceGate)

  const problems = [
    ...missing.map((item) => `${item.id}: manifest is missing at ${item.manifestPath}.`),
    ...insufficient.map(
      (item) =>
        `${item.id}: only ${item.presentFileCount} present files; required ${item.minPresentFiles} for local discovery evidence.`,
    ),
    ...licenseMismatches.map(
      (item) => `${item.id}: licenseStatus is ${item.licenseStatus}; expected ${item.expectedLicense}.`,
    ),
  ]

  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    ok: problems.length === 0,
    decision: problems.length === 0 ? 'public-dataset-discovery-ready' : 'public-dataset-discovery-incomplete',
    summary: {
      candidateCount: audited.length,
      presentCount: audited.filter((item) => item.present).length,
      localEvidenceReadyCount: audited.filter((item) => item.meetsLocalEvidenceGate).length,
      researchSingingReadyCount: researchSinging.length,
      productionEligibleCount: productionReady.length,
    },
    productionConclusion:
      productionReady.length > 0
        ? 'At least one public candidate is marked production-eligible; verify rights before release.'
        : 'No currently acquired public Korean dataset is production-release evidence for a WebUtau neural singer.',
    nextActions: [
      'Use CSD/GTSinger only for local research quality iteration.',
      'Use speech/reference corpora only for pronunciation, ASR, or discovery checks.',
      'For completion, acquire and review release-safe singing data; do not ask the current user or family to record.',
    ],
    problems,
    candidates: audited,
  }

  if (options.report) {
    writeJson(resolve(options.report), report)
  }
  return report
}

function candidate(value) {
  return {
    expectedLicense: null,
    productionEligible: false,
    ...value,
  }
}

function auditCandidate(candidate) {
  const manifestPath = resolve(candidate.manifest)
  const source = readOptionalJson(manifestPath)
  const manifest = source.value ?? {}
  const metrics = manifest.metrics ?? {}
  const file = manifest.file ?? null
  const singleArchivePresent = Boolean(file?.sizeBytes && file?.md5)
  const presentFileCount = Number(metrics.presentFileCount ?? (singleArchivePresent ? 1 : 0))
  const totalPresentBytes = Number(metrics.totalPresentBytes ?? file?.sizeBytes ?? 0)
  const meetsLocalEvidenceGate = source.exists && !source.error && presentFileCount >= candidate.minPresentFiles && totalPresentBytes > 0

  return {
    id: candidate.id,
    label: candidate.label,
    kind: candidate.kind,
    role: candidate.role,
    productionEligible: candidate.productionEligible,
    productionBlocker: candidate.blocker,
    manifestPath,
    present: source.exists && !source.error,
    error: source.error,
    source: manifest.source ?? null,
    sourceUrl: manifest.sourceUrl ?? null,
    licenseStatus: manifest.licenseStatus ?? null,
    expectedLicense: candidate.expectedLicense,
    minPresentFiles: candidate.minPresentFiles,
    presentFileCount,
    totalPresentBytes,
    meetsLocalEvidenceGate,
    metrics,
  }
}

function readOptionalJson(path) {
  if (!existsSync(path)) {
    return { exists: false, error: null, value: null }
  }
  try {
    return { exists: true, error: null, value: JSON.parse(readFileSync(path, 'utf8')) }
  } catch (error) {
    return { exists: true, error: error instanceof Error ? error.message : String(error), value: null }
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--report') {
      parsed.report = argv[++index]
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        [
          'Usage: node scripts/audit-public-dataset-discovery.mjs [options]',
          '',
          'Options:',
          '  --report path  Write JSON discovery report',
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
    const report = auditPublicDatasetDiscovery(parseArgs(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    if (!report.ok) {
      process.exitCode = 1
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
    process.exitCode = 1
  }
}
