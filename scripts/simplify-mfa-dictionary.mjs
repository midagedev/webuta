#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function simplifyMfaDictionary(options) {
  const dictionaryPath = resolve(options.dictionary ?? '')
  const outPath = resolve(options.out ?? '')
  if (!dictionaryPath || !existsSync(dictionaryPath)) {
    throw new Error('Missing or invalid --dictionary path.')
  }
  if (!outPath) {
    throw new Error('Missing --out path.')
  }

  const entries = new Map()
  let inputEntryCount = 0
  for (const rawLine of readFileSync(dictionaryPath, 'utf8').split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) {
      continue
    }
    const columns = line.split('\t').map((column) => column.trim()).filter(Boolean)
    if (columns.length < 2) {
      continue
    }
    inputEntryCount += 1
    const word = columns[0]
    const phones = columns[columns.length - 1]
    if (!entries.has(word) || options.keepLast) {
      entries.set(word, phones)
    }
  }

  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, [...entries.entries()].map(([word, phones]) => `${word}\t${phones}`).join('\n') + '\n')
  const manifestPath = `${outPath}.manifest.json`
  writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        version: 1,
        source: 'webuta-simplify-mfa-dictionary',
        generatedAt: new Date().toISOString(),
        dictionary: dictionaryPath,
        out: outPath,
        inputEntryCount,
        outputEntryCount: entries.size,
        duplicatePronunciationCount: inputEntryCount - entries.size,
        duplicatePolicy: options.keepLast ? 'keep-last' : 'keep-first',
      },
      null,
      2,
    ) + '\n',
  )

  return {
    out: outPath,
    manifest: manifestPath,
    inputEntryCount,
    outputEntryCount: entries.size,
    duplicatePronunciationCount: inputEntryCount - entries.size,
  }
}

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--dictionary') {
      parsed.dictionary = argv[++index]
    } else if (arg === '--out') {
      parsed.out = argv[++index]
    } else if (arg === '--keep-last') {
      parsed.keepLast = true
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        [
          'Usage: node scripts/simplify-mfa-dictionary.mjs --dictionary path --out path [options]',
          '',
          'Options:',
          '  --keep-last   Keep the last pronunciation for duplicate words instead of the first',
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
    const result = simplifyMfaDictionary(parseArgs(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
