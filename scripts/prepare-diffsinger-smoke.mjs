#!/usr/bin/env node

import * as yaml from 'js-yaml'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_DATASET_DIR = 'experiments/neural-singer/work/csd-mfa-smoke/diffsinger-dataset-enhanced'
const DEFAULT_OUT = 'experiments/neural-singer/work/csd-diffsinger-smoke'
const DEFAULT_DIFFSINGER_ROOT = '.local/neural-singer/openvpi/DiffSinger'

export function prepareDiffSingerSmoke(options = {}) {
  const datasetDir = resolve(options.datasetDir ?? DEFAULT_DATASET_DIR)
  const diffSingerRoot = resolve(options.diffSingerRoot ?? DEFAULT_DIFFSINGER_ROOT)
  const outDir = resolve(options.out ?? DEFAULT_OUT)
  const speaker = options.speaker ?? 'csd_kr007a'
  const language = options.language ?? 'ko'
  const transcriptions = resolve(options.transcriptions ?? join(datasetDir, 'transcriptions.csv'))
  const baseConfig = resolve(options.baseConfig ?? join(diffSingerRoot, 'configs', 'acoustic.yaml'))
  const binaryDataDir = resolve(options.binaryDataDir ?? join(outDir, 'binary'))
  const trainWorkDir = resolve(options.trainWorkDir ?? join(outDir, 'train-smoke'))

  assertExists(datasetDir, 'DiffSinger dataset directory')
  assertExists(transcriptions, 'DiffSinger transcriptions.csv')
  assertExists(baseConfig, 'DiffSinger acoustic base config')

  const entries = parseTranscriptions(readFileSync(transcriptions, 'utf8'))
  if (entries.length < 2) {
    throw new Error('DiffSinger smoke training needs at least one train item and one validation item.')
  }
  for (const entry of entries) {
    assertExists(join(datasetDir, 'wavs', `${entry.name}.wav`), `WAV for ${entry.name}`)
  }

  const testPrefixes = normalizeList(options.testPrefixes ?? entries.at(-1).name)
  const matchedValidation = entries.filter((entry) => testPrefixes.some((prefix) => matchesPrefix(entry.name, prefix)))
  if (matchedValidation.length === 0) {
    throw new Error(`No validation item matched --test-prefix: ${testPrefixes.join(', ')}`)
  }
  if (matchedValidation.length === entries.length) {
    throw new Error('Validation prefixes match every item; DiffSinger would have an empty training set.')
  }

  const phoneCounts = countPhones(entries)
  for (const required of ['AP', 'SP']) {
    if (!phoneCounts.has(required)) {
      throw new Error(
        `DiffSinger always includes ${required} in its phoneme inventory, but this smoke dataset does not contain it.`,
      )
    }
  }

  const dictionaryPath = join(outDir, `dictionary-${language}.txt`)
  const configPath = join(outDir, 'config.yaml')
  const manifestPath = join(outDir, 'diffsinger-smoke.manifest.json')
  const runbookPath = join(outDir, 'README.md')
  const dictionaryRows = compactDictionaryRows(phoneCounts)
  const config = smokeConfig({
    baseConfig,
    datasetDir,
    language,
    speaker,
    dictionaryPath,
    binaryDataDir,
    testPrefixes,
  })

  mkdirSync(outDir, { recursive: true })
  writeFileSync(dictionaryPath, `${dictionaryRows.join('\n')}\n`)
  writeFileSync(configPath, yaml.dump(config, { lineWidth: -1, noRefs: true, sortKeys: false }))
  writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        version: 1,
        source: 'webuta-diffsinger-smoke',
        generatedAt: new Date().toISOString(),
        datasetDir,
        transcriptions,
        diffSingerRoot,
        baseConfig,
        config: configPath,
        dictionary: dictionaryPath,
        binaryDataDir,
        trainWorkDir,
        language,
        speaker,
        itemCount: entries.length,
        trainItemCount: entries.length - matchedValidation.length,
        validationItemCount: matchedValidation.length,
        validationItems: matchedValidation.map((entry) => entry.name),
        phoneInventoryCount: phoneCounts.size,
        phoneCounts: Object.fromEntries([...phoneCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
        note: 'CSD smoke data is research-only CC BY-NC-SA 4.0 material. Keep training outputs local unless license terms are separately reviewed.',
      },
      null,
      2,
    )}\n`,
  )
  writeFileSync(runbookPath, smokeRunbook({ diffSingerRoot, configPath, trainWorkDir }))

  return {
    outDir,
    config: configPath,
    dictionary: dictionaryPath,
    manifest: manifestPath,
    runbook: runbookPath,
    itemCount: entries.length,
    trainItemCount: entries.length - matchedValidation.length,
    validationItemCount: matchedValidation.length,
    phoneInventoryCount: phoneCounts.size,
  }
}

function smokeConfig({ baseConfig, datasetDir, language, speaker, dictionaryPath, binaryDataDir, testPrefixes }) {
  return {
    base_config: [baseConfig],
    dictionaries: {
      [language]: dictionaryPath,
    },
    extra_phonemes: [],
    merged_phoneme_groups: [],
    datasets: [
      {
        raw_data_dir: datasetDir,
        speaker,
        spk_id: 0,
        language,
        test_prefixes: testPrefixes,
      },
    ],
    binary_data_dir: binaryDataDir,
    binarization_args: {
      shuffle: false,
      num_workers: 0,
    },
    pe: 'parselmouth',
    hnsep: 'world',
    use_lang_id: false,
    num_lang: 1,
    use_spk_id: false,
    num_spk: 1,
    use_mix_ln: false,
    use_energy_embed: false,
    use_breathiness_embed: false,
    use_voicing_embed: false,
    use_tension_embed: false,
    use_key_shift_embed: false,
    use_speed_embed: false,
    use_stretch_embed: false,
    use_variance_scaling: false,
    augmentation_args: {
      random_pitch_shifting: {
        enabled: false,
        range: [-5.0, 5.0],
        scale: 0.75,
      },
      fixed_pitch_shifting: {
        enabled: false,
        targets: [-5.0, 5.0],
        scale: 0.5,
      },
      random_time_stretching: {
        enabled: false,
        range: [0.5, 2.0],
        scale: 0.75,
      },
    },
    diffusion_type: 'reflow',
    use_shallow_diffusion: false,
    hidden_size: 64,
    enc_layers: 2,
    num_heads: 2,
    dropout: 0.05,
    backbone_type: 'wavenet',
    backbone_args: {
      num_layers: 2,
      num_channels: 64,
      dilation_cycle_length: 2,
    },
    T_start: 0.0,
    T_start_infer: 0.0,
    K_step: 10,
    K_step_infer: 10,
    sampling_steps: 5,
    optimizer_args: {
      optimizer_cls: 'torch.optim.AdamW',
      lr: 0.0005,
      betas: [0.9, 0.98],
      weight_decay: 0.0,
    },
    lr_scheduler_args: {
      scheduler_cls: 'torch.optim.lr_scheduler.StepLR',
      step_size: 100,
      gamma: 0.8,
    },
    max_batch_frames: 20000,
    max_batch_size: 1,
    max_val_batch_frames: 20000,
    max_val_batch_size: 1,
    max_updates: 1,
    val_check_interval: 1,
    num_sanity_val_steps: 0,
    num_valid_plots: 0,
    val_with_vocoder: false,
    num_ckpt_keep: 1,
    permanent_ckpt_start: 0,
    permanent_ckpt_interval: 0,
    ds_workers: 1,
    dataloader_prefetch_factor: 2,
    pl_trainer_accelerator: 'cpu',
    pl_trainer_devices: 1,
    pl_trainer_precision: '32-true',
    pl_trainer_strategy: {
      name: 'auto',
    },
    nccl_p2p: false,
  }
}

function parseTranscriptions(text) {
  const lines = text.split(/\r?\n/u).filter((line) => line.trim())
  const header = splitCsvLine(lines.shift() ?? '')
  const nameIndex = header.indexOf('name')
  const phSeqIndex = header.indexOf('ph_seq')
  const phDurIndex = header.indexOf('ph_dur')
  if ([nameIndex, phSeqIndex, phDurIndex].includes(-1)) {
    throw new Error('DiffSinger transcriptions.csv must include name, ph_seq, and ph_dur columns.')
  }
  return lines.map((line) => {
    const columns = splitCsvLine(line)
    const name = columns[nameIndex]?.trim()
    const phones = columns[phSeqIndex]?.trim().split(/\s+/u).filter(Boolean) ?? []
    const durations = columns[phDurIndex]?.trim().split(/\s+/u).filter(Boolean).map(Number) ?? []
    if (!name) {
      throw new Error(`Missing item name in transcriptions row: ${line}`)
    }
    if (phones.length === 0) {
      throw new Error(`Missing ph_seq for ${name}`)
    }
    if (phones.length !== durations.length) {
      throw new Error(`ph_seq/ph_dur length mismatch for ${name}: ${phones.length} vs ${durations.length}`)
    }
    if (durations.some((duration) => !Number.isFinite(duration) || duration < 0)) {
      throw new Error(`Invalid ph_dur value for ${name}`)
    }
    return {
      name,
      phones,
      durations,
    }
  })
}

function splitCsvLine(line) {
  const result = []
  let current = ''
  let inQuotes = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current)
      current = ''
    } else {
      current += char
    }
  }
  result.push(current)
  return result
}

function countPhones(entries) {
  const counts = new Map()
  for (const entry of entries) {
    for (const phone of entry.phones) {
      counts.set(phone, (counts.get(phone) ?? 0) + 1)
    }
  }
  return counts
}

function compactDictionaryRows(phoneCounts) {
  return [...phoneCounts.keys()]
    .filter((phone) => !['AP', 'SP'].includes(phone))
    .sort((a, b) => a.localeCompare(b))
    .map((phone, index) => `ph_${String(index + 1).padStart(4, '0')}\t${phone}`)
}

function normalizeList(value) {
  if (Array.isArray(value)) {
    return value.map(String).map((item) => item.trim()).filter(Boolean)
  }
  return String(value).split(',').map((item) => item.trim()).filter(Boolean)
}

function matchesPrefix(name, prefix) {
  return name === prefix || name.startsWith(prefix)
}

function smokeRunbook({ diffSingerRoot, configPath, trainWorkDir }) {
  const python = resolve('.local/neural-singer/mamba/envs/webuta-diffsinger/bin/python')
  const projectRoot = resolve('.')
  const demoDs = join(dirname(configPath), 'demo-do-hi-do-hi.ds')
  const dictionary = join(dirname(configPath), 'dictionary-ko.txt')
  const outputDir = join(dirname(configPath), 'outputs')
  return [
    '# DiffSinger CSD Smoke Runbook',
    '',
    'This folder contains local-only DiffSinger smoke configuration for WebUtau.',
    'CSD-derived data and outputs are research-only artifacts and must stay out of git.',
    '',
    '## Commands',
    '',
    '```sh',
    `cd ${shellQuote(diffSingerRoot)}`,
    `${shellQuote(python)} scripts/binarize.py --config ${shellQuote(configPath)}`,
    `${shellQuote(python)} scripts/train.py --config ${shellQuote(configPath)} --exp_name ${shellQuote(trainWorkDir)} --reset`,
    '```',
    '',
    '## Demo Inference',
    '',
    '```sh',
    `cd ${shellQuote(projectRoot)}`,
    `npm run neural:prepare-diffsinger-demo -- --out ${shellQuote(demoDs)} --dictionary ${shellQuote(dictionary)}`,
    `cd ${shellQuote(diffSingerRoot)}`,
    `${shellQuote(python)} scripts/infer.py acoustic ${shellQuote(demoDs)} --exp ${shellQuote(trainWorkDir)} --ckpt 1 --out ${shellQuote(outputDir)} --title demo-do-hi-do-hi --num 1 --mel --steps 5`,
    '```',
    '',
    'For WAV export, install the OpenVPI community PC-NSF-HiFiGAN 44.1 kHz Hop512 128-bin 2025.02 vocoder under the ignored DiffSinger checkpoints folder and run the same inference command without `--mel`.',
    '',
  ].join('\n')
}

function assertExists(path, label) {
  if (!existsSync(path)) {
    throw new Error(`Missing ${label}: ${path}`)
  }
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`
}

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--dataset-dir') {
      parsed.datasetDir = argv[++index]
    } else if (arg === '--transcriptions') {
      parsed.transcriptions = argv[++index]
    } else if (arg === '--diffsinger-root') {
      parsed.diffSingerRoot = argv[++index]
    } else if (arg === '--base-config') {
      parsed.baseConfig = argv[++index]
    } else if (arg === '--out') {
      parsed.out = argv[++index]
    } else if (arg === '--binary-data-dir') {
      parsed.binaryDataDir = argv[++index]
    } else if (arg === '--train-work-dir') {
      parsed.trainWorkDir = argv[++index]
    } else if (arg === '--speaker') {
      parsed.speaker = argv[++index]
    } else if (arg === '--language') {
      parsed.language = argv[++index]
    } else if (arg === '--test-prefix') {
      parsed.testPrefixes = argv[++index]
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        [
          'Usage: node scripts/prepare-diffsinger-smoke.mjs [options]',
          '',
          'Options:',
          `  --dataset-dir path       Enhanced DiffSinger dataset, default ${DEFAULT_DATASET_DIR}`,
          `  --diffsinger-root path   Local DiffSinger checkout, default ${DEFAULT_DIFFSINGER_ROOT}`,
          `  --out path               Local smoke output folder, default ${DEFAULT_OUT}`,
          '  --test-prefix value      Comma-separated validation item prefixes, default last item',
          '  --speaker name           Speaker name in DiffSinger config',
          '  --language code          Language key in DiffSinger config, default ko',
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

export function diffSingerSmokeBasename(path) {
  return dirname(path).split('/').at(-1)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = prepareDiffSingerSmoke(parseArgs(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
