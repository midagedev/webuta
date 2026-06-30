#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function augmentMfaDictionary(options) {
  const basePath = resolve(options.base ?? '')
  const additionsPath = resolve(options.additions ?? '')
  const outPath = resolve(options.out ?? '')
  if (!basePath || !existsSync(basePath)) {
    throw new Error('Missing or invalid --base dictionary path.')
  }
  if (!additionsPath || !existsSync(additionsPath)) {
    throw new Error('Missing or invalid --additions dictionary path.')
  }
  if (!outPath) {
    throw new Error('Missing --out dictionary path.')
  }

  const baseLines = readDictionaryLines(basePath)
  const additionLines = readDictionaryLines(additionsPath)
  const baseWords = new Set(baseLines.map((entry) => entry.word))
  const additions = []
  const skipped = []
  for (const entry of additionLines) {
    if (baseWords.has(entry.word) && !options.includeExisting) {
      skipped.push(entry.word)
      continue
    }
    additions.push(entry)
    baseWords.add(entry.word)
  }

  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, [...baseLines, ...additions].map((entry) => entry.line).join('\n') + '\n')
  const manifestPath = `${outPath}.manifest.json`
  writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        version: 1,
        source: 'webuta-augment-mfa-dictionary',
        generatedAt: new Date().toISOString(),
        base: basePath,
        additions: additionsPath,
        out: outPath,
        baseEntryCount: baseLines.length,
        additionInputCount: additionLines.length,
        addedCount: additions.length,
        skippedExistingCount: skipped.length,
        addedWords: additions.map((entry) => entry.word),
        skippedExistingWords: skipped,
      },
      null,
      2,
    ) + '\n',
  )

  return {
    out: outPath,
    manifest: manifestPath,
    baseEntryCount: baseLines.length,
    additionInputCount: additionLines.length,
    addedCount: additions.length,
    skippedExistingCount: skipped.length,
  }
}

function readDictionaryLines(path) {
  return readFileSync(path, 'utf8')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith('#'))
    .map((line) => {
      const columns = line.split('\t')
      return {
        word: columns[0],
        line,
      }
    })
}

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--base') {
      parsed.base = argv[++index]
    } else if (arg === '--additions') {
      parsed.additions = argv[++index]
    } else if (arg === '--out') {
      parsed.out = argv[++index]
    } else if (arg === '--include-existing') {
      parsed.includeExisting = true
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        [
          'Usage: node scripts/augment-mfa-dictionary.mjs --base path --additions path --out path [options]',
          '',
          'Options:',
          '  --include-existing   Append additions even when the base dictionary already has that word',
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
    const result = augmentMfaDictionary(parseArgs(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
