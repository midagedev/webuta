#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HANGUL_BASE = 0xac00
const HANGUL_END = 0xd7a3
const VOWEL_COUNT = 21
const CODA_COUNT = 28

const ONSET_SYMBOLS = [
  'g',
  'kk',
  'n',
  'd',
  'tt',
  'r',
  'm',
  'b',
  'pp',
  's',
  'ss',
  '',
  'j',
  'jj',
  'ch',
  'k',
  't',
  'p',
  'h',
]

const VOWEL_SYMBOLS = [
  'a',
  'ae',
  'ya',
  'yae',
  'eo',
  'e',
  'yeo',
  'ye',
  'o',
  'wa',
  'wae',
  'oe',
  'yo',
  'u',
  'wo',
  'we',
  'wi',
  'yu',
  'eu',
  'ui',
  'i',
]

const CODA_SYMBOLS = [
  '',
  'g',
  'kk',
  'gs',
  'n',
  'nj',
  'nh',
  'd',
  'r',
  'rg',
  'rm',
  'rb',
  'rs',
  'rt',
  'rp',
  'rh',
  'm',
  'b',
  'bs',
  's',
  'ss',
  'ng',
  'j',
  'ch',
  'k',
  't',
  'p',
  'h',
]

const NON_LYRIC_LABELS = new Set(['SP', 'AP', '<PAD>', 'sil', 'br', 'R', '-'])

export function prepareKoreanMfaDictionary(options) {
  const seedDir = options.seedDir ? resolve(options.seedDir) : null
  const labelDir = resolve(options.labelDir ?? (seedDir ? join(seedDir, 'raw', 'wavs') : ''))
  if (!labelDir || !existsSync(labelDir)) {
    throw new Error('Missing or invalid --label-dir path. You can also pass --seed-dir for an OpenVPI seed corpus.')
  }

  const outputDir = resolve(options.out ?? (seedDir ? join(seedDir, 'mfa-korean') : join(labelDir, '..', 'mfa-korean')))
  const labFiles = listLabFiles(labelDir)
  if (labFiles.length === 0) {
    throw new Error(`No .lab files found in ${labelDir}.`)
  }

  const tokenCounts = new Map()
  const unsupported = new Map()
  const multiSyllableTokens = new Set()
  const sourceFiles = []

  for (const labFile of labFiles) {
    const text = readFileSync(labFile, 'utf8')
    const tokens = tokenizeLabelText(text)
    sourceFiles.push({
      file: labFile,
      tokenCount: tokens.length,
    })
    for (const token of tokens) {
      if (isNonLyricLabel(token)) {
        continue
      }
      tokenCounts.set(token, (tokenCounts.get(token) ?? 0) + 1)
      if (hangulSyllableCount(token) > 1) {
        multiSyllableTokens.add(token)
      }
      const pronunciation = pronunciationForToken(token)
      if (!pronunciation) {
        unsupported.set(token, (unsupported.get(token) ?? 0) + 1)
      }
    }
  }

  if (unsupported.size > 0 && !options.allowUnsupported) {
    const sample = [...unsupported.keys()].slice(0, 8).join(', ')
    throw new Error(`Unsupported MFA label tokens found: ${sample}. Remove them, split them, or rerun with --allow-unsupported to write a report only.`)
  }

  mkdirSync(outputDir, { recursive: true })

  const dictionaryEntries = []
  const phoneCounts = new Map()
  for (const token of sortedKeys(tokenCounts)) {
    const phones = pronunciationForToken(token)
    if (!phones) {
      continue
    }
    dictionaryEntries.push({ token, phones, count: tokenCounts.get(token) ?? 0 })
    for (const phone of phones) {
      phoneCounts.set(phone, (phoneCounts.get(phone) ?? 0) + (tokenCounts.get(token) ?? 0))
    }
  }

  const dictionaryPath = join(outputDir, 'korean.dict')
  const phonesPath = join(outputDir, 'phones.txt')
  const reportPath = join(outputDir, 'oov-report.json')
  const manifestPath = join(outputDir, 'mfa-dictionary.manifest.json')

  writeFileSync(dictionaryPath, dictionaryEntries.map((entry) => `${entry.token}\t${entry.phones.join(' ')}`).join('\n') + '\n')
  writeFileSync(phonesPath, sortedKeys(phoneCounts).join('\n') + '\n')
  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        unsupportedTokens: sortedKeys(unsupported).map((token) => ({
          token,
          count: unsupported.get(token),
        })),
        multiSyllableTokens: [...multiSyllableTokens].sort(koreanSort).map((token) => ({
          token,
          count: tokenCounts.get(token),
          note: 'OpenVPI labels are safest when Korean lyrics are split into syllable tokens.',
        })),
      },
      null,
      2,
    ) + '\n',
  )
  writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        version: 1,
        source: 'webuta-korean-mfa-dictionary',
        generatedAt: new Date().toISOString(),
        seedDir,
        labelDir,
        labFileCount: labFiles.length,
        tokenCount: [...tokenCounts.values()].reduce((sum, count) => sum + count, 0),
        uniqueTokenCount: tokenCounts.size,
        dictionaryEntryCount: dictionaryEntries.length,
        unsupportedTokenCount: unsupported.size,
        phoneInventoryCount: phoneCounts.size,
        dictionary: dictionaryPath,
        phones: phonesPath,
        report: reportPath,
        sourceFiles,
        phoneCounts: Object.fromEntries([...phoneCounts.entries()].sort(([a], [b]) => koreanSort(a, b))),
      },
      null,
      2,
    ) + '\n',
  )
  writeFileSync(join(outputDir, 'README.md'), dictionaryReadme({ labelDir, dictionaryPath, phonesPath, reportPath }))

  return {
    outputDir,
    labelDir,
    labFileCount: labFiles.length,
    tokenCount: [...tokenCounts.values()].reduce((sum, count) => sum + count, 0),
    uniqueTokenCount: tokenCounts.size,
    dictionaryEntryCount: dictionaryEntries.length,
    unsupportedTokenCount: unsupported.size,
    phoneInventoryCount: phoneCounts.size,
    dictionary: dictionaryPath,
    phones: phonesPath,
    report: reportPath,
    manifest: manifestPath,
  }
}

export function pronunciationForToken(token) {
  if (!token || isNonLyricLabel(token)) {
    return null
  }

  const phones = []
  for (const char of token) {
    const charPhones = phonesForHangulSyllable(char)
    if (!charPhones) {
      return null
    }
    phones.push(...charPhones)
  }
  return phones.length > 0 ? phones : null
}

function isNonLyricLabel(token) {
  return NON_LYRIC_LABELS.has(String(token).replace(/^<|>$/g, '').toUpperCase())
}

function phonesForHangulSyllable(char) {
  const code = char.codePointAt(0) ?? 0
  if (code < HANGUL_BASE || code > HANGUL_END) {
    return null
  }

  const offset = code - HANGUL_BASE
  const onsetIndex = Math.floor(offset / (VOWEL_COUNT * CODA_COUNT))
  const vowelIndex = Math.floor((offset % (VOWEL_COUNT * CODA_COUNT)) / CODA_COUNT)
  const codaIndex = offset % CODA_COUNT
  const onset = ONSET_SYMBOLS[onsetIndex] ?? ''
  const vowel = VOWEL_SYMBOLS[vowelIndex] ?? ''
  const coda = CODA_SYMBOLS[codaIndex] ?? ''
  return [onset, vowel, coda].filter(Boolean)
}

function tokenizeLabelText(text) {
  return text
    .split(/\s+/u)
    .map((token) => token.trim())
    .filter(Boolean)
}

function listLabFiles(labelDir) {
  return readdirSync(labelDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.lab'))
    .map((entry) => join(labelDir, entry.name))
    .sort(koreanSort)
}

function sortedKeys(map) {
  return [...map.keys()].sort(koreanSort)
}

function koreanSort(a, b) {
  return a.localeCompare(b, 'ko')
}

function hangulSyllableCount(token) {
  return [...token].filter((char) => {
    const code = char.codePointAt(0) ?? 0
    return code >= HANGUL_BASE && code <= HANGUL_END
  }).length
}

function dictionaryReadme({ labelDir, dictionaryPath, phonesPath, reportPath }) {
  return [
    '# Korean MFA Dictionary',
    '',
    'Generated from WebUtau/OpenVPI `.lab` labels.',
    '',
    'This dictionary is a phoneme-inventory bridge, not a complete acoustic model.',
    'MFA alignment still requires a Korean-compatible acoustic model trained for the same phone set.',
    '',
    '## Files',
    '',
    `- Dictionary: \`${basename(dictionaryPath)}\``,
    `- Phone inventory: \`${basename(phonesPath)}\``,
    `- OOV report: \`${basename(reportPath)}\``,
    '',
    '## Next Commands',
    '',
    'Validate labels with MakeDiffSinger tooling:',
    '',
    '```sh',
    `python .local/neural-singer/openvpi/MakeDiffSinger/acoustic_forced_alignment/validate_labels.py --dir ${labelDir} --dictionary ${dictionaryPath}`,
    '```',
    '',
    'Then run MFA only after you have a matching Korean acoustic model:',
    '',
    '```sh',
    `mfa align ${labelDir} ${dictionaryPath} path/to/korean-acoustic-model.zip path/to/textgrids --clean --overwrite`,
    '```',
    '',
  ].join('\n')
}

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--seed-dir') {
      parsed.seedDir = argv[++index]
    } else if (arg === '--label-dir') {
      parsed.labelDir = argv[++index]
    } else if (arg === '--out') {
      parsed.out = argv[++index]
    } else if (arg === '--allow-unsupported') {
      parsed.allowUnsupported = true
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        [
          'Usage: node scripts/prepare-korean-mfa-dictionary.mjs [--seed-dir path | --label-dir path] [options]',
          '',
          'Options:',
          '  --seed-dir path          OpenVPI seed corpus containing raw/wavs/*.lab',
          '  --label-dir path         Directory containing .lab files',
          '  --out path               Output directory for dictionary and reports',
          '  --allow-unsupported      Write supported entries even if labels contain unsupported tokens',
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
    const result = prepareKoreanMfaDictionary(parseArgs(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
