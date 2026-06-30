#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_DATASET_DIR = 'experiments/neural-singer/work/csd-mfa-smoke/diffsinger-dataset-enhanced'
const DEFAULT_BLANK_PHONE = 'SP'

export function repairDiffSingerTranscriptions(options = {}) {
  const datasetDir = resolve(options.datasetDir ?? DEFAULT_DATASET_DIR)
  const transcriptionsPath = resolve(options.transcriptions ?? join(datasetDir, 'transcriptions.csv'))
  const wavDir = resolve(options.wavDir ?? join(datasetDir, 'wavs'))
  const out = resolve(options.out ?? `${datasetDir}-repaired`)
  const blankPhone = String(options.blankPhone ?? DEFAULT_BLANK_PHONE)
  if (!blankPhone.trim()) {
    throw new Error('blankPhone must not be empty.')
  }
  if (!existsSync(transcriptionsPath)) {
    throw new Error(`Missing transcriptions.csv: ${transcriptionsPath}`)
  }
  if (!existsSync(wavDir)) {
    throw new Error(`Missing wavs directory: ${wavDir}`)
  }
  if (existsSync(out)) {
    if (!options.force) {
      throw new Error(`Output already exists: ${out}. Pass --force to replace it.`)
    }
    rmSync(out, { recursive: true, force: true })
  }

  const parsed = parseCsv(readFileSync(transcriptionsPath, 'utf8'))
  const header = parsed.rows.shift() ?? []
  const nameIndex = header.indexOf('name')
  const phSeqIndex = header.indexOf('ph_seq')
  const phDurIndex = header.indexOf('ph_dur')
  if ([nameIndex, phSeqIndex, phDurIndex].includes(-1)) {
    throw new Error('DiffSinger transcriptions.csv must include name, ph_seq, and ph_dur columns.')
  }

  const repairedRows = []
  const unresolved = []
  let changedRowCount = 0
  let insertedBlankPhoneCount = 0

  for (const [rowIndex, row] of parsed.rows.entries()) {
    const cells = [...row]
    while (cells.length < header.length) {
      cells.push('')
    }
    const durations = splitSpaceTokens(cells[phDurIndex])
    const phoneRepair = repairPhoneSequence(cells[phSeqIndex], {
      blankPhone,
      expectedCount: durations.length,
    })
    cells[phSeqIndex] = phoneRepair.phones.join(' ')
    if (phoneRepair.changed) {
      changedRowCount += 1
      insertedBlankPhoneCount += phoneRepair.insertedBlankPhoneCount
    }
    if (phoneRepair.phones.length !== durations.length) {
      unresolved.push({
        row: rowIndex + 2,
        name: cells[nameIndex] || null,
        phoneCount: phoneRepair.phones.length,
        durationCount: durations.length,
      })
    }
    repairedRows.push(cells.slice(0, header.length))
  }

  if (unresolved.length > 0 && !options.allowUnresolved) {
    throw new Error(`Unable to repair ${unresolved.length} transcription rows; pass --allow-unresolved to write a best-effort copy.`)
  }

  mkdirSync(out, { recursive: true })
  cpSync(wavDir, join(out, 'wavs'), { recursive: true })
  const repairedCsv = toCsv([header, ...repairedRows])
  writeFileSync(join(out, 'transcriptions.csv'), repairedCsv)

  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    sourceDatasetDir: datasetDir,
    sourceTranscriptions: transcriptionsPath,
    sourceWavDir: wavDir,
    out,
    blankPhone,
    rowCount: repairedRows.length,
    changedRowCount,
    insertedBlankPhoneCount,
    unresolvedCount: unresolved.length,
    unresolved,
  }
  writeJson(join(out, 'webuta-diffsinger-transcription-repair.json'), report)
  if (options.report) {
    writeJson(resolve(options.report), report)
  }
  return report
}

export function repairPhoneSequence(value, options = {}) {
  const raw = String(value ?? '')
  const blankPhone = String(options.blankPhone ?? DEFAULT_BLANK_PHONE)
  const expectedCount = Number(options.expectedCount ?? NaN)
  const collapsed = splitSpaceTokens(raw)
  if (!Number.isFinite(expectedCount) || collapsed.length === expectedCount) {
    return {
      phones: collapsed,
      changed: false,
      insertedBlankPhoneCount: 0,
    }
  }

  const expanded = raw.split(' ').map((phone) => phone.trim() || blankPhone)
  const insertedBlankPhoneCount = expanded.filter((phone, index) => phone === blankPhone && raw.split(' ')[index]?.trim() === '').length
  return {
    phones: expanded,
    changed: expanded.join(' ') !== collapsed.join(' '),
    insertedBlankPhoneCount,
  }
}

function splitSpaceTokens(value) {
  return String(value ?? '').trim().split(/\s+/u).filter(Boolean)
}

function parseCsv(text) {
  const rows = []
  let current = ''
  let row = []
  let inQuotes = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === '"') {
      if (inQuotes && text[index + 1] === '"') {
        current += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === ',' && !inQuotes) {
      row.push(current)
      current = ''
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && text[index + 1] === '\n') {
        index += 1
      }
      row.push(current)
      if (row.some((cell) => cell.length > 0)) {
        rows.push(row)
      }
      row = []
      current = ''
    } else {
      current += char
    }
  }
  if (current.length > 0 || row.length > 0) {
    row.push(current)
    if (row.some((cell) => cell.length > 0)) {
      rows.push(row)
    }
  }
  return { rows }
}

function toCsv(rows) {
  return `${rows.map((row) => row.map(toCsvCell).join(',')).join('\n')}\n`
}

function toCsvCell(cell) {
  const value = String(cell ?? '')
  if (!/[",\r\n]/u.test(value)) {
    return value
  }
  return `"${value.replaceAll('"', '""')}"`
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--dataset-dir') {
      parsed.datasetDir = argv[++index]
    } else if (arg === '--transcriptions') {
      parsed.transcriptions = argv[++index]
    } else if (arg === '--wav-dir') {
      parsed.wavDir = argv[++index]
    } else if (arg === '--out') {
      parsed.out = argv[++index]
    } else if (arg === '--blank-phone') {
      parsed.blankPhone = argv[++index]
    } else if (arg === '--report') {
      parsed.report = argv[++index]
    } else if (arg === '--force') {
      parsed.force = true
    } else if (arg === '--allow-unresolved') {
      parsed.allowUnresolved = true
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        [
          'Usage: node scripts/repair-diffsinger-transcriptions.mjs [options]',
          '',
          'Options:',
          `  --dataset-dir path       Enhanced dataset dir, default ${DEFAULT_DATASET_DIR}`,
          '  --transcriptions path    Override input transcriptions.csv path',
          '  --wav-dir path           Override input wavs directory',
          '  --out path               Output repaired dataset dir',
          `  --blank-phone phone      Phone to insert for blank intervals, default ${DEFAULT_BLANK_PHONE}`,
          '  --report path            Write JSON repair report',
          '  --force                  Replace output directory if it exists',
          '  --allow-unresolved       Write even if some rows still mismatch',
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
    const report = repairDiffSingerTranscriptions(parseArgs(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
