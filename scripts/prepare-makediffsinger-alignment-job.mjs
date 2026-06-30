#!/usr/bin/env node

import { chmodSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_MAKEDIFFSINGER_ROOT = '.local/neural-singer/openvpi/MakeDiffSinger'
const DEFAULT_BEAM = 100

export function prepareMakeDiffSingerAlignmentJob(options = {}) {
  const seedDir = resolveRequiredPath(options.seedDir, 'OpenVPI seed dir')
  const labelDir = resolve(options.labelDir ?? join(seedDir, 'raw', 'wavs'))
  const dictionary = resolveRequiredPath(options.dictionary, 'MFA dictionary')
  const outDir = resolve(options.out ?? join(dirname(seedDir), 'makediffsinger-alignment-job'))
  const makeDiffSingerRoot = resolve(options.makeDiffSingerRoot ?? DEFAULT_MAKEDIFFSINGER_ROOT)
  const alignmentToolsDir = resolve(options.alignmentToolsDir ?? join(makeDiffSingerRoot, 'acoustic_forced_alignment'))
  const python = options.python ?? 'python'
  const mfaCommand = options.mfaCommand ?? 'mfa'
  const mfaModel = options.mfaModel ? resolve(options.mfaModel) : null
  const beam = positiveInteger(options.beam, DEFAULT_BEAM)
  const production = Boolean(options.production)
  const normalize = Boolean(options.normalize)
  const skipSilenceInsertion = Boolean(options.skipSilenceInsertion)
  const reformattedDir = resolve(options.reformattedDir ?? join(outDir, 'reformatted-wavs'))
  const rawTextgridsDir = resolve(options.rawTextgridsDir ?? join(outDir, 'textgrids-raw'))
  const enhancedTextgridsDir = resolve(options.enhancedTextgridsDir ?? join(outDir, 'textgrids-enhanced'))
  const enhancedDatasetDir = resolve(options.enhancedDatasetDir ?? join(outDir, 'diffsinger-dataset-enhanced'))
  const enhancedDatasetAudit = resolve(options.enhancedDatasetAudit ?? join(outDir, 'enhanced-dataset-audit.json'))
  const scriptsDir = join(outDir, 'scripts')
  const manifestPath = join(outDir, 'makediffsinger-alignment-job.manifest.json')
  const readmePath = join(outDir, 'README.md')

  assertDirectory(seedDir, 'OpenVPI seed dir')
  assertDirectory(labelDir, 'OpenVPI seed label/audio dir')
  assertFile(dictionary, 'MFA dictionary')
  assertToolingScripts(alignmentToolsDir)

  const labFiles = readdirSync(labelDir).filter((name) => name.endsWith('.lab')).sort((a, b) => a.localeCompare(b))
  const wavFiles = readdirSync(labelDir).filter((name) => name.endsWith('.wav')).sort((a, b) => a.localeCompare(b))
  if (labFiles.length === 0) {
    throw new Error(`No .lab files found in seed label dir: ${labelDir}`)
  }
  if (wavFiles.length === 0) {
    throw new Error(`No .wav files found in seed label dir: ${labelDir}`)
  }

  mkdirSync(scriptsDir, { recursive: true })
  const scripts = writeScripts({
    scriptsDir,
    alignmentToolsDir,
    python,
    mfaCommand,
    mfaModel,
    beam,
    labelDir,
    dictionary,
    reformattedDir,
    rawTextgridsDir,
    enhancedTextgridsDir,
    enhancedDatasetDir,
    enhancedDatasetAudit,
    production,
    normalize,
    skipSilenceInsertion,
  })

  const warnings = []
  if (!mfaModel) {
    warnings.push('No MFA acoustic model was supplied. Set WEBUTA_MFA_MODEL or regenerate with --mfa-model before running 02-run-mfa-align.sh.')
  } else if (!existsSync(mfaModel)) {
    warnings.push(`MFA acoustic model does not exist yet: ${mfaModel}`)
  }

  const manifest = {
    version: 1,
    source: 'webuta-makediffsinger-alignment-job',
    generatedAt: new Date().toISOString(),
    production,
    seedDir,
    labelDir,
    labelCount: labFiles.length,
    wavCount: wavFiles.length,
    dictionary,
    makeDiffSingerRoot,
    alignmentToolsDir,
    python,
    mfaCommand,
    mfaModel,
    mfaModelExists: Boolean(mfaModel && existsSync(mfaModel)),
    beam,
    normalize,
    skipSilenceInsertion,
    outputs: {
      reformattedDir,
      rawTextgridsDir,
      enhancedTextgridsDir,
      enhancedDatasetDir,
      enhancedDatasetAudit,
    },
    scripts,
    warnings,
    nextActions: [
      'Run scripts/00-validate-labels.sh and fix label/dictionary coverage before alignment.',
      'Run scripts/01-reformat-wavs.sh, then scripts/02-run-mfa-align.sh with an approved Korean MFA acoustic model.',
      'Run scripts/03-check-textgrids.sh and scripts/04-enhance-textgrids.sh; inspect TextGrids before training if alignment quality is poor.',
      'Run scripts/05-build-dataset.sh and scripts/06-audit-enhanced-dataset.sh before preparing the DiffSinger training run.',
    ],
  }

  writeJson(manifestPath, manifest)
  writeFileSync(readmePath, readmeText(manifest))

  return {
    outDir,
    manifest: manifestPath,
    readme: readmePath,
    scripts,
    enhancedDatasetDir,
    enhancedDatasetAudit,
    warnings,
  }
}

function writeScripts({
  scriptsDir,
  alignmentToolsDir,
  python,
  mfaCommand,
  mfaModel,
  beam,
  labelDir,
  dictionary,
  reformattedDir,
  rawTextgridsDir,
  enhancedTextgridsDir,
  enhancedDatasetDir,
  enhancedDatasetAudit,
  production,
  normalize,
  skipSilenceInsertion,
}) {
  const scriptSpecs = [
    [
      '00-validate-labels.sh',
      [
        ...scriptPreamble({ alignmentToolsDir, python, mfaCommand, mfaModel }),
        '"$PYTHON" validate_labels.py --dir "$LABEL_DIR" --dictionary "$DICTIONARY"',
      ],
    ],
    [
      '01-reformat-wavs.sh',
      [
        ...scriptPreamble({ alignmentToolsDir, python, mfaCommand, mfaModel }),
        'mkdir -p "$REFORMATTED_DIR"',
        `"$PYTHON" reformat_wavs.py --src "$LABEL_DIR" --dst "$REFORMATTED_DIR"${normalize ? ' --normalize' : ''}`,
      ],
    ],
    [
      '02-run-mfa-align.sh',
      [
        ...scriptPreamble({ alignmentToolsDir, python, mfaCommand, mfaModel }),
        'if [[ -z "$MFA_MODEL" || ! -f "$MFA_MODEL" ]]; then',
        '  echo "Set WEBUTA_MFA_MODEL to a Korean MFA acoustic model zip before alignment." >&2',
        '  exit 2',
        'fi',
        'mkdir -p "$RAW_TEXTGRIDS_DIR"',
        `"$MFA_COMMAND" align "$REFORMATTED_DIR" "$DICTIONARY" "$MFA_MODEL" "$RAW_TEXTGRIDS_DIR" --beam ${beam} --clean --overwrite`,
      ],
    ],
    [
      '03-check-textgrids.sh',
      [
        ...scriptPreamble({ alignmentToolsDir, python, mfaCommand, mfaModel }),
        '"$PYTHON" check_tg.py --wavs "$REFORMATTED_DIR" --tg "$RAW_TEXTGRIDS_DIR"',
      ],
    ],
    [
      '04-enhance-textgrids.sh',
      [
        ...scriptPreamble({ alignmentToolsDir, python, mfaCommand, mfaModel }),
        'mkdir -p "$ENHANCED_TEXTGRIDS_DIR"',
        '"$PYTHON" enhance_tg.py --wavs "$REFORMATTED_DIR" --dictionary "$DICTIONARY" --src "$RAW_TEXTGRIDS_DIR" --dst "$ENHANCED_TEXTGRIDS_DIR"',
      ],
    ],
    [
      '05-build-dataset.sh',
      [
        ...scriptPreamble({ alignmentToolsDir, python, mfaCommand, mfaModel }),
        'mkdir -p "$ENHANCED_DATASET_DIR"',
        `"$PYTHON" build_dataset.py --wavs "$REFORMATTED_DIR" --tg "$ENHANCED_TEXTGRIDS_DIR" --dataset "$ENHANCED_DATASET_DIR"${skipSilenceInsertion ? ' --skip_silence_insertion' : ''}`,
      ],
    ],
    [
      '06-audit-enhanced-dataset.sh',
      [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        `ENHANCED_DATASET_DIR=${shellQuote(enhancedDatasetDir)}`,
        `ENHANCED_DATASET_AUDIT=${shellQuote(enhancedDatasetAudit)}`,
        `npm run neural:audit-enhanced-dataset -- --dataset-dir "$ENHANCED_DATASET_DIR" --report "$ENHANCED_DATASET_AUDIT"${production ? ' --production' : ''}`,
      ],
    ],
  ]

  const scripts = {}
  for (const [name, lines] of scriptSpecs) {
    const path = join(scriptsDir, name)
    writeFileSync(path, `${lines.join('\n')}\n`)
    chmodSync(path, 0o755)
    scripts[name] = path
  }
  const runAll = join(scriptsDir, 'run-all.sh')
  writeFileSync(
    runAll,
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
      'for script in 00-validate-labels.sh 01-reformat-wavs.sh 02-run-mfa-align.sh 03-check-textgrids.sh 04-enhance-textgrids.sh 05-build-dataset.sh 06-audit-enhanced-dataset.sh; do',
      '  "$SCRIPT_DIR/$script"',
      'done',
      '',
    ].join('\n'),
  )
  chmodSync(runAll, 0o755)
  scripts['run-all.sh'] = runAll
  return scripts

  function scriptPreamble({ alignmentToolsDir, python, mfaCommand, mfaModel }) {
    return [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      `MAKE_DIFFSINGER_AFA=${shellQuote(alignmentToolsDir)}`,
      `LABEL_DIR=${shellQuote(labelDir)}`,
      `DICTIONARY=${shellQuote(dictionary)}`,
      `REFORMATTED_DIR=${shellQuote(reformattedDir)}`,
      `RAW_TEXTGRIDS_DIR=${shellQuote(rawTextgridsDir)}`,
      `ENHANCED_TEXTGRIDS_DIR=${shellQuote(enhancedTextgridsDir)}`,
      `ENHANCED_DATASET_DIR=${shellQuote(enhancedDatasetDir)}`,
      'PYTHON=${WEBUTA_MAKEDIFFSINGER_PYTHON:-}',
      'if [[ -z "$PYTHON" ]]; then',
      `  PYTHON=${shellQuote(python)}`,
      'fi',
      'MFA_COMMAND=${WEBUTA_MFA_COMMAND:-}',
      'if [[ -z "$MFA_COMMAND" ]]; then',
      `  MFA_COMMAND=${shellQuote(mfaCommand)}`,
      'fi',
      'MFA_MODEL=${WEBUTA_MFA_MODEL:-}',
      'if [[ -z "$MFA_MODEL" ]]; then',
      `  MFA_MODEL=${shellQuote(mfaModel ?? '')}`,
      'fi',
      'cd "$MAKE_DIFFSINGER_AFA"',
    ]
  }
}

function assertToolingScripts(alignmentToolsDir) {
  assertDirectory(alignmentToolsDir, 'MakeDiffSinger acoustic_forced_alignment dir')
  for (const script of ['validate_labels.py', 'reformat_wavs.py', 'check_tg.py', 'enhance_tg.py', 'build_dataset.py']) {
    assertFile(join(alignmentToolsDir, script), `MakeDiffSinger ${script}`)
  }
}

function assertDirectory(path, label) {
  if (!existsSync(path)) {
    throw new Error(`Missing ${label}: ${path}`)
  }
}

function assertFile(path, label) {
  if (!existsSync(path)) {
    throw new Error(`Missing ${label}: ${path}`)
  }
}

function resolveRequiredPath(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing --${label.toLowerCase().replaceAll(' ', '-')}.`)
  }
  return resolve(value)
}

function positiveInteger(value, fallback) {
  const number = Number(value)
  if (Number.isInteger(number) && number > 0) {
    return number
  }
  return fallback
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function readmeText(manifest) {
  return [
    '# MakeDiffSinger Alignment Job',
    '',
    'This folder bridges a WebUtau OpenVPI seed corpus to a MakeDiffSinger-enhanced DiffSinger dataset.',
    'It does not contain provider archives or model checkpoints.',
    '',
    '## Inputs',
    '',
    `- Seed labels/audio: \`${manifest.labelDir}\``,
    `- Dictionary: \`${manifest.dictionary}\``,
    `- MakeDiffSinger tools: \`${manifest.alignmentToolsDir}\``,
    `- MFA model: \`${manifest.mfaModel ?? '(set WEBUTA_MFA_MODEL)'}\``,
    '',
    '## Run Order',
    '',
    '```sh',
    './scripts/00-validate-labels.sh',
    './scripts/01-reformat-wavs.sh',
    'WEBUTA_MFA_MODEL=/path/to/korean-acoustic-model.zip ./scripts/02-run-mfa-align.sh',
    './scripts/03-check-textgrids.sh',
    './scripts/04-enhance-textgrids.sh',
    './scripts/05-build-dataset.sh',
    './scripts/06-audit-enhanced-dataset.sh',
    '```',
    '',
    'The final enhanced dataset path is:',
    '',
    `\`${manifest.outputs.enhancedDatasetDir}\``,
    '',
  ].join('\n')
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`
}

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--seed-dir') {
      parsed.seedDir = argv[++index]
    } else if (arg === '--label-dir') {
      parsed.labelDir = argv[++index]
    } else if (arg === '--dictionary') {
      parsed.dictionary = argv[++index]
    } else if (arg === '--out') {
      parsed.out = argv[++index]
    } else if (arg === '--make-diffsinger-root') {
      parsed.makeDiffSingerRoot = argv[++index]
    } else if (arg === '--alignment-tools-dir') {
      parsed.alignmentToolsDir = argv[++index]
    } else if (arg === '--python') {
      parsed.python = argv[++index]
    } else if (arg === '--mfa-command') {
      parsed.mfaCommand = argv[++index]
    } else if (arg === '--mfa-model') {
      parsed.mfaModel = argv[++index]
    } else if (arg === '--beam') {
      parsed.beam = Number(argv[++index])
    } else if (arg === '--production') {
      parsed.production = true
    } else if (arg === '--normalize') {
      parsed.normalize = true
    } else if (arg === '--skip-silence-insertion') {
      parsed.skipSilenceInsertion = true
    } else if (arg === '--reformatted-dir') {
      parsed.reformattedDir = argv[++index]
    } else if (arg === '--raw-textgrids-dir') {
      parsed.rawTextgridsDir = argv[++index]
    } else if (arg === '--enhanced-textgrids-dir') {
      parsed.enhancedTextgridsDir = argv[++index]
    } else if (arg === '--enhanced-dataset-dir') {
      parsed.enhancedDatasetDir = argv[++index]
    } else if (arg === '--enhanced-dataset-audit') {
      parsed.enhancedDatasetAudit = argv[++index]
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        [
          'Usage: node scripts/prepare-makediffsinger-alignment-job.mjs --seed-dir path --dictionary path [options]',
          '',
          'Options:',
          '  --out path                         Output alignment job directory',
          '  --make-diffsinger-root path        MakeDiffSinger checkout root',
          '  --alignment-tools-dir path         acoustic_forced_alignment directory',
          '  --python path                      Python executable for MakeDiffSinger scripts',
          '  --mfa-command path                 MFA executable, default mfa',
          '  --mfa-model path                   MFA acoustic model zip',
          '  --beam n                           MFA beam value, default 100',
          '  --production                       Audit enhanced dataset with production gates',
          '  --normalize                        Pass --normalize to reformat_wavs.py',
          '  --skip-silence-insertion           Pass --skip_silence_insertion to build_dataset.py',
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
    const result = prepareMakeDiffSingerAlignmentJob(parseArgs(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
