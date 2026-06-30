#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_KOREAN_MFA_DICTIONARY = '.local/neural-singer/mfa-root/pretrained_models/dictionary/korean_mfa.dict'
const NON_LYRIC_LABELS = new Set(['SP', 'AP', '<PAD>', 'SIL', 'BR', 'R', '-'])

export function auditMfaLabelCoverage(options) {
  const seedDir = options.seedDir ? resolve(options.seedDir) : null
  const labelDir = resolve(options.labelDir ?? (seedDir ? join(seedDir, 'raw', 'wavs') : ''))
  const dictionaryPath = resolve(options.dictionary ?? DEFAULT_KOREAN_MFA_DICTIONARY)
  if (!labelDir || !existsSync(labelDir)) {
    throw new Error('Missing or invalid --label-dir path. You can also pass --seed-dir for an OpenVPI seed corpus.')
  }
  if (!existsSync(dictionaryPath)) {
    throw new Error(`Missing MFA dictionary: ${dictionaryPath}`)
  }

  const dictionary = readMfaDictionary(dictionaryPath)
  const labFiles = listLabFiles(labelDir)
  if (labFiles.length === 0) {
    throw new Error(`No .lab files found in ${labelDir}.`)
  }

  const tokenCounts = new Map()
  const covered = new Map()
  const oov = new Map()
  const phoneCounts = new Map()
  const sourceFiles = []

  for (const labFile of labFiles) {
    const tokens = tokenizeLabelText(readFileSync(labFile, 'utf8'))
    sourceFiles.push({ file: labFile, tokenCount: tokens.length })
    for (const token of tokens) {
      if (isNonLyricLabel(token)) {
        continue
      }
      tokenCounts.set(token, (tokenCounts.get(token) ?? 0) + 1)
      const pronunciations = dictionary.entries.get(token)
      if (!pronunciations) {
        oov.set(token, (oov.get(token) ?? 0) + 1)
        continue
      }
      covered.set(token, (covered.get(token) ?? 0) + 1)
      for (const phone of pronunciations[0]) {
        phoneCounts.set(phone, (phoneCounts.get(phone) ?? 0) + 1)
      }
    }
  }

  if (oov.size > 0 && !options.allowOov) {
    const sample = sortedKeys(oov).slice(0, 8).join(', ')
    throw new Error(`OOV label tokens for MFA dictionary: ${sample}. Fix labels/dictionary or rerun with --allow-oov to write the report.`)
  }

  const outputDir = resolve(options.out ?? (seedDir ? join(seedDir, 'mfa-label-audit') : join(labelDir, '..', 'mfa-label-audit')))
  mkdirSync(outputDir, { recursive: true })

  const report = {
    version: 1,
    source: 'webuta-mfa-label-coverage',
    generatedAt: new Date().toISOString(),
    seedDir,
    labelDir,
    dictionary: dictionaryPath,
    labFileCount: labFiles.length,
    dictionaryEntryCount: dictionary.entryCount,
    dictionaryWordCount: dictionary.entries.size,
    tokenCount: [...tokenCounts.values()].reduce((sum, count) => sum + count, 0),
    uniqueTokenCount: tokenCounts.size,
    coveredUniqueTokenCount: covered.size,
    oovUniqueTokenCount: oov.size,
    phoneInventoryCount: phoneCounts.size,
    coveredTokens: sortedKeys(covered).map((token) => ({
      token,
      count: covered.get(token),
      pronunciationCount: dictionary.entries.get(token)?.length ?? 0,
      phones: dictionary.entries.get(token)?.[0] ?? [],
    })),
    oovTokens: sortedKeys(oov).map((token) => ({
      token,
      count: oov.get(token),
    })),
    phoneCounts: Object.fromEntries([...phoneCounts.entries()].sort(([a], [b]) => koreanSort(a, b))),
    sourceFiles,
  }

  const reportPath = join(outputDir, 'mfa-label-coverage.json')
  const phonesPath = join(outputDir, 'phones-from-labels.txt')
  const oovPath = join(outputDir, 'oov-tokens.txt')
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  writeFileSync(phonesPath, sortedKeys(phoneCounts).join('\n') + '\n')
  writeFileSync(oovPath, sortedKeys(oov).join('\n') + (oov.size > 0 ? '\n' : ''))

  return {
    outputDir,
    report: reportPath,
    phones: phonesPath,
    oov: oovPath,
    labFileCount: report.labFileCount,
    tokenCount: report.tokenCount,
    uniqueTokenCount: report.uniqueTokenCount,
    coveredUniqueTokenCount: report.coveredUniqueTokenCount,
    oovUniqueTokenCount: report.oovUniqueTokenCount,
    phoneInventoryCount: report.phoneInventoryCount,
  }
}

export function readMfaDictionary(path) {
  const entries = new Map()
  let entryCount = 0
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) {
      continue
    }
    const columns = line.split('\t').map((column) => column.trim()).filter(Boolean)
    if (columns.length < 2) {
      continue
    }
    const word = columns[0]
    const phones = columns[columns.length - 1].split(/\s+/u).filter(Boolean)
    if (phones.length === 0) {
      continue
    }
    const pronunciations = entries.get(word) ?? []
    pronunciations.push(phones)
    entries.set(word, pronunciations)
    entryCount += 1
  }
  return { entries, entryCount }
}

function tokenizeLabelText(text) {
  return text
    .split(/\s+/u)
    .map((token) => token.trim())
    .filter(Boolean)
}

function isNonLyricLabel(token) {
  return NON_LYRIC_LABELS.has(String(token).replace(/^<|>$/g, '').toUpperCase())
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
    } else if (arg === '--allow-oov') {
      parsed.allowOov = true
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        [
          'Usage: node scripts/audit-mfa-label-coverage.mjs [--seed-dir path | --label-dir path] [options]',
          '',
          'Options:',
          '  --seed-dir path       OpenVPI seed corpus containing raw/wavs/*.lab',
          '  --label-dir path      Directory containing .lab files',
          `  --dictionary path     MFA dictionary, default ${DEFAULT_KOREAN_MFA_DICTIONARY}`,
          '  --out path            Output directory for coverage report',
          '  --allow-oov           Write report even if labels contain OOV tokens',
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
    const result = auditMfaLabelCoverage(parseArgs(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
