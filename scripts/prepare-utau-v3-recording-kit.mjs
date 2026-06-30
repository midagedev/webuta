#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_OUT = 'experiments/utau-v3/recording-kit'
const DEFAULT_SINGER_ID = 'webuta-ko-v3'
const DEFAULT_SINGER_NAME = 'WebUtau Korean V3'
const DEFAULT_PITCHES = ['C4', 'F4', 'A4']

const ONSETS = [
  ['g', 'ㄱ'],
  ['kk', 'ㄲ'],
  ['n', 'ㄴ'],
  ['d', 'ㄷ'],
  ['tt', 'ㄸ'],
  ['r', 'ㄹ'],
  ['m', 'ㅁ'],
  ['b', 'ㅂ'],
  ['pp', 'ㅃ'],
  ['s', 'ㅅ'],
  ['ss', 'ㅆ'],
  ['', 'ㅇ'],
  ['j', 'ㅈ'],
  ['jj', 'ㅉ'],
  ['ch', 'ㅊ'],
  ['k', 'ㅋ'],
  ['t', 'ㅌ'],
  ['p', 'ㅍ'],
  ['h', 'ㅎ'],
]

const VOWELS = [
  ['a', 'ㅏ'],
  ['ae', 'ㅐ'],
  ['ya', 'ㅑ'],
  ['yae', 'ㅒ'],
  ['eo', 'ㅓ'],
  ['e', 'ㅔ'],
  ['yeo', 'ㅕ'],
  ['ye', 'ㅖ'],
  ['o', 'ㅗ'],
  ['wa', 'ㅘ'],
  ['wae', 'ㅙ'],
  ['oe', 'ㅚ'],
  ['yo', 'ㅛ'],
  ['u', 'ㅜ'],
  ['wo', 'ㅝ'],
  ['we', 'ㅞ'],
  ['wi', 'ㅟ'],
  ['yu', 'ㅠ'],
  ['eu', 'ㅡ'],
  ['ui', 'ㅢ'],
  ['i', 'ㅣ'],
]

const COMMON_CODAS = [
  ['n', 'ㄴ'],
  ['ng', 'ㅇ'],
  ['m', 'ㅁ'],
  ['r', 'ㄹ'],
  ['g', 'ㄱ'],
  ['d', 'ㄷ'],
  ['b', 'ㅂ'],
  ['s', 'ㅅ'],
  ['k', 'ㅋ'],
  ['t', 'ㅌ'],
  ['p', 'ㅍ'],
  ['h', 'ㅎ'],
]

const DEMO_PRIORITY = ['도', '히', '다', '이', '스', '키', '연', '하', '나', '라', '마', '사']

export function prepareUtauV3RecordingKit(options = {}) {
  const outDir = resolve(options.out ?? DEFAULT_OUT)
  const singerId = sanitizeId(options.singerId ?? DEFAULT_SINGER_ID)
  const singerName = String(options.singerName ?? DEFAULT_SINGER_NAME)
  const pitches = parsePitches(options.pitches ?? DEFAULT_PITCHES)
  const profile = options.profile ?? 'community-cvvc-lite'
  const generatedAt = new Date().toISOString()
  const reclist = buildReclist({ pitches, profile })
  const manifest = {
    version: 1,
    generatedAt,
    singerId,
    singerName,
    profile,
    pitches,
    releaseStatus: 'recording-kit-only',
    licenseStatus: 'requires-original-singer-release',
    unitCounts: summarizeUnits(reclist),
    demoPriorityAliases: DEMO_PRIORITY,
    files: {
      reclist: 'reclist/v3-cvvc-lite.csv',
      otoTemplate: 'templates/oto-template.ini',
      characterTemplate: 'templates/character.yaml',
      recordingGuide: 'recording-guide.md',
      licenseReleaseTemplate: 'license-release.template.md',
      manifest: 'webuta-ko-v3-recording-kit.manifest.json',
    },
  }

  mkdirSync(join(outDir, 'reclist'), { recursive: true })
  mkdirSync(join(outDir, 'templates'), { recursive: true })
  mkdirSync(dirname(join(outDir, 'webuta-ko-v3-recording-kit.manifest.json')), { recursive: true })

  writeFileSync(join(outDir, 'reclist', 'v3-cvvc-lite.csv'), reclistCsv(reclist))
  writeFileSync(join(outDir, 'templates', 'oto-template.ini'), otoTemplate(reclist))
  writeFileSync(join(outDir, 'templates', 'character.yaml'), characterYaml({ singerName }))
  writeFileSync(join(outDir, 'recording-guide.md'), recordingGuide({ singerName, singerId, pitches, reclist }))
  writeFileSync(join(outDir, 'license-release.template.md'), licenseReleaseTemplate({ singerName, singerId }))
  writeFileSync(join(outDir, 'README.md'), kitReadme({ singerName, singerId, pitches, reclist }))
  writeFileSync(join(outDir, 'webuta-ko-v3-recording-kit.manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

  return {
    outDir,
    singerId,
    singerName,
    profile,
    pitches,
    unitCounts: manifest.unitCounts,
    aliasCount: reclist.length,
  }
}

export function buildReclist({ pitches = DEFAULT_PITCHES } = {}) {
  const rows = []
  for (const pitch of pitches) {
    for (const [onsetRoman, onset] of ONSETS) {
      for (const [vowelRoman, vowel] of VOWELS) {
        const syllable = hangulSyllable(ONSETS.findIndex((item) => item[1] === onset), VOWELS.findIndex((item) => item[1] === vowel))
        const roman = `${onsetRoman}${vowelRoman}`
        rows.push(unitRow({
          type: 'CV',
          pitch,
          alias: syllable,
          roman: roman || vowelRoman,
          prompt: promptForCv(syllable),
          fileName: `cv_${safeName(roman || vowelRoman)}_${pitch}.wav`,
          priority: DEMO_PRIORITY.includes(syllable) ? 'demo' : 'core',
        }))
      }
    }
    for (const [vowelRoman, vowel] of VOWELS) {
      rows.push(unitRow({
        type: 'V',
        pitch,
        alias: vowel,
        roman: vowelRoman,
        prompt: `${vowel} - 길게 유지`,
        fileName: `v_${vowelRoman}_${pitch}.wav`,
        priority: 'sustain',
      }))
      for (const [codaRoman, coda] of COMMON_CODAS) {
        rows.push(unitRow({
          type: 'VC',
          pitch,
          alias: `${vowel}${coda}`,
          roman: `${vowelRoman}${codaRoman}`,
          prompt: `${vowel}${coda} - 받침을 마지막에 짧게`,
          fileName: `vc_${vowelRoman}_${codaRoman}_${pitch}.wav`,
          priority: codaRoman === 'n' || codaRoman === 'ng' || codaRoman === 'm' || codaRoman === 'r' ? 'core-coda' : 'extended-coda',
        }))
      }
    }
  }
  return rows
}

function unitRow(value) {
  return {
    id: `${value.type.toLowerCase()}-${safeName(value.roman)}-${value.pitch}`.replace(/-+/g, '-'),
    ...value,
    expectedSampleRate: 48000,
    expectedChannels: 'mono',
    targetSeconds: value.type === 'VC' ? 0.9 : 1.4,
  }
}

function summarizeUnits(rows) {
  return rows.reduce(
    (summary, row) => {
      summary.total += 1
      summary.byType[row.type] = (summary.byType[row.type] ?? 0) + 1
      summary.byPitch[row.pitch] = (summary.byPitch[row.pitch] ?? 0) + 1
      if (row.priority === 'demo') {
        summary.demoPriority += 1
      }
      return summary
    },
    { total: 0, demoPriority: 0, byType: {}, byPitch: {} },
  )
}

function reclistCsv(rows) {
  return [
    'id,type,pitch,alias,roman,prompt,fileName,priority,targetSeconds,expectedSampleRate,expectedChannels',
    ...rows.map((row) =>
      [
        row.id,
        row.type,
        row.pitch,
        row.alias,
        row.roman,
        row.prompt,
        row.fileName,
        row.priority,
        row.targetSeconds,
        row.expectedSampleRate,
        row.expectedChannels,
      ].map(csvCell).join(','),
    ),
    '',
  ].join('\n')
}

function otoTemplate(rows) {
  return [
    '; WebUtau Korean V3 oto template',
    '; Values are placeholders. Run the V3 sample processor and manual review before release.',
    ...rows.map((row) => {
      const consonant = row.type === 'VC' ? 70 : 150
      const preutterance = row.type === 'VC' ? 35 : 70
      const overlap = row.type === 'VC' ? 20 : 35
      return `${row.fileName}=${row.alias},0,${consonant},-220,${preutterance},${overlap}`
    }),
    '',
  ].join('\n')
}

function characterYaml({ singerName }) {
  return [
    `name: ${singerName}`,
    'text_file_encoding: utf-8',
    'author: WebUtau Project',
    'web: https://midagedev.github.io/webuta/',
    '',
  ].join('\n')
}

function recordingGuide({ singerName, singerId, pitches, reclist }) {
  return [
    `# ${singerName} Recording Guide`,
    '',
    `Singer id: \`${singerId}\``,
    `Pitch layers: ${pitches.join(', ')}`,
    `Required units: ${reclist.length}`,
    '',
    '## Setup',
    '',
    '- Record dry mono WAV at 48 kHz / 24-bit when possible.',
    '- Keep mic distance, room, gain, and posture fixed for the full session.',
    '- Use a quiet guide tone for pitch, but do not let it bleed into the microphone.',
    '- Hold vowels steadily. Avoid spoken pitch fall during the sustain body.',
    '- Leave a short silence before and after each take.',
    '',
    '## Review Rules',
    '',
    '- Reject clipped takes.',
    '- Reject takes where the consonant attack is missing.',
    '- Reject takes where the vowel drops sharply in pitch.',
    '- Reject takes with audible room reflections or background noise.',
    '- Mark uncertain takes for rerecording instead of forcing them into V3.',
    '',
    '## Next',
    '',
    '1. Record WAVs with the exact `fileName` values in `reclist/v3-cvvc-lite.csv`.',
    '2. Keep raw recordings and signed release files out of git.',
    '3. Run the future V3 processing/audit scripts before building `webuta-ko-v3.zip`.',
    '',
  ].join('\n')
}

function licenseReleaseTemplate({ singerName, singerId }) {
  return [
    `# ${singerName} Voice Release Template`,
    '',
    'This template is not legal advice. Fill and sign it before using recordings in a public V3 voicebank.',
    '',
    `- Singer display name: ${singerName}`,
    `- Singer id: ${singerId}`,
    '- Recording date(s):',
    '- Recorder/reviewer:',
    '- Public voicebank redistribution allowed: yes/no',
    '- Generated user audio sharing allowed: yes/no',
    '- Commercial generated user audio allowed: yes/no',
    '- Attribution requirement:',
    '- Prohibited uses, if any:',
    '- Signed by singer/guardian/rights holder:',
    '- Review date:',
    '',
    'Keep the signed copy outside git unless the signer explicitly approves public publication.',
    '',
  ].join('\n')
}

function kitReadme({ singerName, singerId, pitches, reclist }) {
  return [
    `# ${singerName} UTAU V3 Recording Kit`,
    '',
    'This folder is a generated planning kit for a license-clean WebUtau Korean V3 voicebank.',
    '',
    `- Singer id: \`${singerId}\``,
    `- Pitch layers: ${pitches.join(', ')}`,
    `- Total planned aliases: ${reclist.length}`,
    '- Format target: UTAU zip with WAV samples, oto.ini, character.yaml, readme.txt, license.txt.',
    '',
    'The kit does not contain the final singer recordings. It is safe to commit the script that creates it, but raw WAVs and signed releases should stay private until release review passes.',
    '',
  ].join('\n')
}

function promptForCv(syllable) {
  return `${syllable} - 자음은 또렷하게, 모음은 일정하게 유지`
}

function parsePitches(pitches) {
  if (Array.isArray(pitches)) {
    return pitches.map(String).filter(Boolean)
  }
  return String(pitches)
    .split(',')
    .map((pitch) => pitch.trim())
    .filter(Boolean)
}

function hangulSyllable(onsetIndex, vowelIndex) {
  return String.fromCharCode(0xac00 + onsetIndex * 21 * 28 + vowelIndex * 28)
}

function safeName(value) {
  return String(value || 'vowel')
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}_-]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
    .slice(0, 48)
}

function sanitizeId(value) {
  return safeName(value).toLowerCase() || DEFAULT_SINGER_ID
}

function csvCell(value) {
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--out') {
      options.out = argv[++index]
    } else if (arg === '--singer-id') {
      options.singerId = argv[++index]
    } else if (arg === '--singer-name') {
      options.singerName = argv[++index]
    } else if (arg === '--pitches') {
      options.pitches = argv[++index]
    } else if (arg === '--profile') {
      options.profile = argv[++index]
    } else if (arg === '--help') {
      console.log(
        [
          'Usage: node scripts/prepare-utau-v3-recording-kit.mjs [options]',
          '',
          'Options:',
          '  --out path                Output kit directory',
          '  --singer-id id            Singer id, default webuta-ko-v3',
          '  --singer-name name        Singer display name',
          '  --pitches C4,F4,A4        Comma-separated pitch layers',
          '  --profile name            Kit profile label',
        ].join('\n'),
      )
      process.exit(0)
    }
  }
  return options
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = prepareUtauV3RecordingKit(parseArgs(process.argv.slice(2)))
  console.log(JSON.stringify(result, null, 2))
}
