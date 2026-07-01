import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { createUtauSampleRenderer } from './renderers/utauSampleRenderer'
import { TICKS_PER_BEAT, type SongProject } from './types'
import {
  analyzeVoicebankCoverage,
  analyzeVoicebankRenderWarnings,
  loadVoicebankZip,
  type LoadedVoicebank,
  type OtoEntry,
} from './voicebank'

const REPORT_PATH = process.env.WEBUTA_UTAU_COMPAT_REPORT

type OtoFixture = {
  directory?: string
  fileName: string
  samplePath?: string
  alias: string
  offsetMs?: number
  consonantMs?: number
  cutoffMs?: number
  preutteranceMs?: number
  overlapMs?: number
  durationSeconds?: number
  frequency?: number
}

type NoteFixture = {
  lyric: string
  tone: number
  duration?: number
}

type CompatibilityFixture = {
  id: string
  title: string
  fileName: string
  rootDir: string
  characterName: string
  characterFormat?: 'yaml' | 'txt'
  characterEncoding?: 'utf-8' | 'shift-jis'
  otoEncoding?: 'utf-8' | 'shift-jis'
  prefixMap?: string
  entries: OtoFixture[]
  notes: NoteFixture[]
  expectedAliases: {
    mode: 'exact' | 'contains'
    values: string[]
  }
  expectedSamplePaths?: {
    mode: 'exact' | 'contains'
    values: string[]
  }
  expectedPrefixMapPaths?: string[]
}

type CaseReport = {
  id: string
  title: string
  passed: boolean
  zip: {
    fileName: string
    sourceFileName: string
    sampleCount: number
    wavCount: number
    aliasCount: number
    aliases: string[]
    characterPath?: string
    prefixMapPaths: string[]
  }
  project: {
    name: string
    noteCount: number
    lyricLine: string
  }
  coverage: ReturnType<typeof analyzeVoicebankCoverage>
  warnings: Pick<ReturnType<typeof analyzeVoicebankRenderWarnings>, 'warningCount' | 'errorCount' | 'warnings'>
  render: {
    sampleRate: number
    durationSeconds: number
    peak: number
    rms: number
    nonFiniteSampleCount: number
    requestedAliases: string[]
    requestedPaths: string[]
  }
  checks: Array<{ check: string; passed: boolean }>
  problems: string[]
}

describe('UTAU import compatibility smoke audit', () => {
  it('renders diverse UTAU-format zip fixtures through the browser sample renderer', async () => {
    const cases: CaseReport[] = []
    for (const fixture of makeCompatibilityFixtures()) {
      cases.push(await auditCompatibilityFixture(fixture))
    }
    const problems = cases.flatMap((item) => item.problems.map((problem) => `${item.id}: ${problem}`))
    const report = {
      version: 1,
      generatedAt: new Date().toISOString(),
      ok: problems.length === 0,
      decision: problems.length === 0 ? 'utau-import-compatibility-audit-pass' : 'utau-import-compatibility-audit-fail',
      caseCount: cases.length,
      cases,
      problems,
    }

    if (REPORT_PATH) {
      writeJson(resolve(REPORT_PATH), report)
    }

    expect(report.caseCount).toBeGreaterThanOrEqual(9)
    expect(report.problems).toEqual([])
    expect(report.ok).toBe(true)
  }, 30000)
})

async function auditCompatibilityFixture(fixture: CompatibilityFixture): Promise<CaseReport> {
  const zipBlob = await buildVoicebankZip(fixture)
  const voicebank = await loadVoicebankZip(new File([zipBlob], fixture.fileName))
  const project = makeProject(fixture)
  const coverage = analyzeVoicebankCoverage(voicebank, project.notes)
  const warnings = analyzeVoicebankRenderWarnings(voicebank, project.notes)
  const logged = withRequestLog(voicebank)
  const audioContext = {
    async decodeAudioData(buffer: ArrayBuffer) {
      return decodeWavToAudioBuffer(buffer)
    },
  } as unknown as AudioContext
  const renderer = createUtauSampleRenderer(logged.voicebank, audioContext)
  const renderResult = await renderer.render(project)
  const renderStats = measureSamples(renderResult.samples)
  const checks: Array<{ check: string; passed: boolean }> = []
  const problems: string[] = []
  const addCheck = (check: string, passed: boolean, problem = check) => {
    checks.push({ check, passed })
    if (!passed) {
      problems.push(problem)
    }
  }

  addCheck('voicebank zip parsed with every fixture sample', voicebank.sampleCount >= fixture.entries.length)
  addCheck('voicebank wav inventory matches fixture', voicebank.wavCount >= fixture.entries.length)
  addCheck(
    'voicebank character metadata names the singer',
    voicebank.name === fixture.characterName,
    `voicebank name ${voicebank.name} did not match ${fixture.characterName}`,
  )
  addCheck(
    'voicebank character metadata path loaded',
    voicebank.metadata.characterPath === expectedCharacterPath(fixture),
    `character path ${voicebank.metadata.characterPath ?? 'missing'} did not match ${expectedCharacterPath(fixture)}`,
  )
  addCheck('all project lyrics matched aliases', coverage.fallbackNotes === 0, `fallback lyrics: ${coverage.fallbackLyrics.join(', ')}`)
  addCheck('render warning report has zero errors', warnings.errorCount === 0, `${warnings.errorCount} render errors`)
  addCheck('render warning report has zero warnings', warnings.warningCount === 0, `${warnings.warningCount} render warnings`)
  addCheck('renderer produced 44.1 kHz audio', renderResult.sampleRate === 44100, `sampleRate ${renderResult.sampleRate}`)
  addCheck('renderer produced audible peak', renderStats.peak > 0.02, `peak ${renderStats.peak.toFixed(5)}`)
  addCheck('renderer produced audible rms', renderStats.rms > 0.001, `rms ${renderStats.rms.toFixed(5)}`)
  addCheck(
    'renderer produced finite samples',
    renderStats.nonFiniteSampleCount === 0,
    `${renderStats.nonFiniteSampleCount} non-finite samples`,
  )
  addCheck(
    'renderer requested expected oto aliases',
    aliasesMatch(logged.requestedAliases, fixture.expectedAliases),
    `requested aliases ${JSON.stringify(logged.requestedAliases)} did not match ${JSON.stringify(fixture.expectedAliases.values)}`,
  )
  if (fixture.expectedSamplePaths) {
    addCheck(
      'renderer requested expected WAV sample paths',
      valuesMatch(logged.requestedPaths, fixture.expectedSamplePaths),
      `requested paths ${JSON.stringify(logged.requestedPaths)} did not match ${JSON.stringify(fixture.expectedSamplePaths.values)}`,
    )
  }
  for (const expectedPath of fixture.expectedPrefixMapPaths ?? []) {
    addCheck(
      `prefix.map path ${expectedPath} loaded`,
      voicebank.metadata.prefixMapPaths?.includes(expectedPath) === true,
      `missing prefix.map path ${expectedPath}`,
    )
  }

  return {
    id: fixture.id,
    title: fixture.title,
    passed: problems.length === 0,
    zip: {
      fileName: fixture.fileName,
      sourceFileName: voicebank.sourceFileName,
      sampleCount: voicebank.sampleCount,
      wavCount: voicebank.wavCount,
      aliasCount: voicebank.aliases.length,
      aliases: voicebank.aliases,
      characterPath: voicebank.metadata.characterPath,
      prefixMapPaths: voicebank.metadata.prefixMapPaths ?? [],
    },
    project: {
      name: project.name,
      noteCount: project.notes.length,
      lyricLine: project.notes.map((note) => note.lyric).join(' '),
    },
    coverage,
    warnings: {
      warningCount: warnings.warningCount,
      errorCount: warnings.errorCount,
      warnings: warnings.warnings,
    },
    render: {
      sampleRate: renderResult.sampleRate,
      durationSeconds: roundNumber(renderResult.durationSeconds),
      peak: roundNumber(renderStats.peak),
      rms: roundNumber(renderStats.rms),
      nonFiniteSampleCount: renderStats.nonFiniteSampleCount,
      requestedAliases: logged.requestedAliases,
      requestedPaths: logged.requestedPaths,
    },
    checks,
    problems,
  }
}

function makeCompatibilityFixtures(): CompatibilityFixture[] {
  return [
    {
      id: 'japanese-cv-kana',
      title: 'Japanese CV kana aliases from Korean guide lyrics',
      fileName: 'compat-japanese-cv.zip',
      rootDir: 'TetoLike',
      characterName: 'Compatibility CV Singer',
      entries: [
        { fileName: 'do_C4.wav', alias: 'ど', frequency: 262 },
        { fileName: 'hi_C4.wav', alias: 'ひ', frequency: 294 },
        { fileName: 'da_C4.wav', alias: 'だ', frequency: 330 },
        { fileName: 'i_C4.wav', alias: 'い', frequency: 349 },
        { fileName: 'su_C4.wav', alias: 'す', frequency: 392 },
        { fileName: 'ki_C4.wav', alias: 'き', frequency: 440 },
      ],
      notes: [
        { lyric: '도', tone: 60 },
        { lyric: '히', tone: 62 },
        { lyric: '다', tone: 64 },
        { lyric: '이', tone: 65 },
        { lyric: '스', tone: 67 },
        { lyric: '키', tone: 69 },
      ],
      expectedAliases: { mode: 'exact', values: ['ど', 'ひ', 'だ', 'い', 'す', 'き'] },
    },
    {
      id: 'japanese-vcv-context',
      title: 'Japanese VCV phrase-start and previous-vowel aliases',
      fileName: 'compat-japanese-vcv.zip',
      rootDir: 'TetoLike',
      characterName: 'Compatibility VCV Singer',
      entries: [
        { fileName: 'start_do_C4.wav', alias: '- ど', frequency: 262 },
        { fileName: 'o_hi_C4.wav', alias: 'o ひ', frequency: 294 },
        { fileName: 'i_do_C4.wav', alias: 'i ど', frequency: 330 },
      ],
      notes: [
        { lyric: '도', tone: 60 },
        { lyric: '히', tone: 62 },
        { lyric: '도', tone: 64 },
      ],
      expectedAliases: { mode: 'exact', values: ['- ど', 'o ひ', 'i ど'] },
    },
    {
      id: 'prefix-map-multipitch',
      title: 'prefix.map multipitch suffix aliases',
      fileName: 'compat-prefix-map.zip',
      rootDir: 'PrefixSinger',
      characterName: 'Compatibility Prefix Singer',
      prefixMap: ['C4\t\t_LOW', 'G4\t\t_HIGH'].join('\r\n'),
      entries: [
        { fileName: 'soft.wav', alias: 'あ_LOW', frequency: 262 },
        { fileName: 'bright.wav', alias: 'あ_HIGH', frequency: 392 },
      ],
      notes: [
        { lyric: 'a', tone: 60 },
        { lyric: 'a', tone: 67 },
      ],
      expectedAliases: { mode: 'exact', values: ['あ_LOW', 'あ_HIGH'] },
      expectedPrefixMapPaths: ['PrefixSinger/prefix.map'],
    },
    {
      id: 'shift-jis-oto',
      title: 'Shift-JIS encoded oto.ini aliases',
      fileName: 'compat-shift-jis-oto.zip',
      rootDir: 'ShiftJisSinger',
      characterName: 'Compatibility Shift-JIS Singer',
      otoEncoding: 'shift-jis',
      entries: [{ fileName: 'a_C4.wav', alias: 'あ', frequency: 262 }],
      notes: [{ lyric: 'a', tone: 60 }],
      expectedAliases: { mode: 'exact', values: ['あ'] },
    },
    {
      id: 'legacy-character-txt',
      title: 'Legacy UTAU character.txt metadata',
      fileName: 'compat-legacy-character-txt.zip',
      rootDir: 'LegacySinger',
      characterName: 'テスト Singer',
      characterFormat: 'txt',
      characterEncoding: 'shift-jis',
      otoEncoding: 'shift-jis',
      entries: [{ fileName: 'a_C4.wav', alias: 'あ', frequency: 262 }],
      notes: [{ lyric: 'a', tone: 60 }],
      expectedAliases: { mode: 'exact', values: ['あ'] },
    },
    {
      id: 'hangul-cv-vc-coda',
      title: 'Hangul coda lyric rendered as CV sustain plus VC tail',
      fileName: 'compat-hangul-coda.zip',
      rootDir: 'WebUtau',
      characterName: 'Compatibility Korean Coda Singer',
      entries: [
        { fileName: 'yeo_C4.wav', alias: '여', frequency: 262, durationSeconds: 1.1 },
        { fileName: 'yeon_C4.wav', alias: '연', frequency: 262, durationSeconds: 0.7 },
        { fileName: 'yeo_n_C4.wav', alias: 'ㅕㄴ', frequency: 180, durationSeconds: 0.32, consonantMs: 70, cutoffMs: -180 },
      ],
      notes: [{ lyric: '연', tone: 60, duration: TICKS_PER_BEAT * 3 }],
      expectedAliases: { mode: 'contains', values: ['여', 'ㅕㄴ'] },
    },
    {
      id: 'multi-oto-style-ranking',
      title: 'Multi-oto singer prefers plain single-sound alias over styled fallback',
      fileName: 'compat-multi-oto-style.zip',
      rootDir: 'TetoLike',
      characterName: 'Compatibility Style Singer',
      entries: [
        { directory: '重音テトささやき単独音', fileName: '_do_C4.wav', alias: 'ど囁', frequency: 262 },
        { directory: '重音テト単独音', fileName: '_do_C4.wav', alias: 'ど', frequency: 262 },
      ],
      notes: [{ lyric: '도', tone: 62 }],
      expectedAliases: { mode: 'exact', values: ['ど'] },
    },
    {
      id: 'folder-scoped-oto-duplicates',
      title: 'Folder-scoped oto.ini keeps duplicate WAV file names separate',
      fileName: 'compat-folder-scoped-oto.zip',
      rootDir: 'FolderSinger',
      characterName: 'Compatibility Folder-Scoped Singer',
      entries: [
        { fileName: 'a_C4.wav', alias: 'あ_DARK', frequency: 190 },
        { directory: 'bright', fileName: 'a_C4.wav', alias: 'あ', frequency: 440 },
        { directory: 'soft', fileName: 'a_C4.wav', alias: 'あ_SOFT', frequency: 240 },
      ],
      notes: [{ lyric: 'a', tone: 69 }],
      expectedAliases: { mode: 'exact', values: ['あ'] },
      expectedSamplePaths: { mode: 'exact', values: ['FolderSinger/bright/a_C4.wav'] },
    },
    {
      id: 'windows-backslash-oto-path',
      title: 'Windows-style backslash sample paths in oto.ini',
      fileName: 'compat-windows-backslash-oto-path.zip',
      rootDir: 'WindowsSinger',
      characterName: 'Compatibility Windows Path Singer',
      entries: [{ fileName: 'sub\\a_C4.wav', samplePath: 'sub/a_C4.wav', alias: 'あ', frequency: 262 }],
      notes: [{ lyric: 'a', tone: 60 }],
      expectedAliases: { mode: 'exact', values: ['あ'] },
      expectedSamplePaths: { mode: 'exact', values: ['WindowsSinger/sub/a_C4.wav'] },
    },
  ]
}

async function buildVoicebankZip(fixture: CompatibilityFixture) {
  const zip = new JSZip()
  if (fixture.characterFormat === 'txt') {
    const characterText = `name=${fixture.characterName}\r\nsample=a_C4.wav\r\n`
    zip.file(
      `${fixture.rootDir}/character.txt`,
      fixture.characterEncoding === 'shift-jis' ? encodeShiftJisSubset(characterText) : characterText,
    )
  } else {
    zip.file(`${fixture.rootDir}/character.yaml`, `name: ${fixture.characterName}\n`)
  }
  zip.file(`${fixture.rootDir}/readme.txt`, 'WebUtau compatibility fixture voicebank.\n')
  zip.file(`${fixture.rootDir}/license.txt`, 'Synthetic test fixture samples generated in this test.\n')
  if (fixture.prefixMap) {
    zip.file(`${fixture.rootDir}/prefix.map`, `${fixture.prefixMap}\n`)
  }

  const groups = new Map<string, OtoFixture[]>()
  for (const entry of fixture.entries) {
    const directory = [fixture.rootDir, entry.directory].filter(Boolean).join('/')
    groups.set(directory, [...(groups.get(directory) ?? []), entry])
  }
  for (const [directory, entries] of groups) {
    const otoLines: string[] = []
    for (const entry of entries) {
      otoLines.push(
        [
          `${entry.fileName}=${entry.alias}`,
          entry.offsetMs ?? 0,
          entry.consonantMs ?? 120,
          entry.cutoffMs ?? 0,
          entry.preutteranceMs ?? 40,
          entry.overlapMs ?? 20,
        ].join(','),
      )
      zip.file(
        `${directory}/${entry.samplePath ?? entry.fileName}`,
        makePcm16Wav({
          durationSeconds: entry.durationSeconds ?? 0.95,
          frequency: entry.frequency ?? 260,
        }),
      )
    }
    const otoText = `${otoLines.join('\r\n')}\r\n`
    zip.file(`${directory}/oto.ini`, fixture.otoEncoding === 'shift-jis' ? encodeShiftJisSubset(otoText) : otoText)
  }
  return zip.generateAsync({ type: 'blob', compression: 'STORE' })
}

function makeProject(fixture: CompatibilityFixture): SongProject {
  let position = 0
  const notes = fixture.notes.map((note, index) => {
    const duration = note.duration ?? TICKS_PER_BEAT
    const item = {
      id: `${fixture.id}-${index + 1}`,
      trackId: 'track-main',
      partId: 'part-main',
      start: position,
      duration,
      tone: note.tone,
      lyric: note.lyric,
    }
    position += duration
    return item
  })
  return {
    id: `project-${fixture.id}`,
    name: fixture.title,
    comment: 'UTAU import compatibility smoke fixture.',
    bpm: 120,
    beatPerBar: 4,
    beatUnit: 4,
    tracks: [{ id: 'track-main', name: 'Vocal', color: '#ff4fc3' }],
    parts: [{ id: 'part-main', trackId: 'track-main', name: 'Compatibility phrase', start: 0, duration: position }],
    notes,
  }
}

function expectedCharacterPath(fixture: CompatibilityFixture) {
  return `${fixture.rootDir}/character.${fixture.characterFormat === 'txt' ? 'txt' : 'yaml'}`
}

function withRequestLog(voicebank: LoadedVoicebank) {
  const requestedAliases: string[] = []
  const requestedPaths: string[] = []
  return {
    requestedAliases,
    requestedPaths,
    voicebank: {
      ...voicebank,
      async readSample(entry: OtoEntry) {
        requestedAliases.push(entry.alias)
        requestedPaths.push(entry.path)
        return voicebank.readSample(entry)
      },
    } satisfies LoadedVoicebank,
  }
}

function aliasesMatch(actual: string[], expected: { mode: 'exact' | 'contains'; values: string[] }) {
  return valuesMatch(actual, expected)
}

function valuesMatch(actual: string[], expected: { mode: 'exact' | 'contains'; values: string[] }) {
  if (expected.mode === 'exact') {
    return actual.length === expected.values.length && actual.every((alias, index) => alias === expected.values[index])
  }
  return expected.values.every((alias) => actual.includes(alias))
}

function makePcm16Wav(options: { durationSeconds: number; frequency: number; sampleRate?: number }) {
  const sampleRate = options.sampleRate ?? 44100
  const frameCount = Math.floor(options.durationSeconds * sampleRate)
  const dataBytes = frameCount * 2
  const bytes = new Uint8Array(44 + dataBytes)
  const view = new DataView(bytes.buffer)
  writeFourCc(bytes, 0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeFourCc(bytes, 8, 'WAVE')
  writeFourCc(bytes, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeFourCc(bytes, 36, 'data')
  view.setUint32(40, dataBytes, true)
  for (let frame = 0; frame < frameCount; frame += 1) {
    const time = frame / sampleRate
    const attack = Math.min(1, time / 0.045)
    const release = Math.min(1, (options.durationSeconds - time) / 0.14)
    const vibrato = 1 + Math.sin(time * Math.PI * 2 * 5.2) * 0.004
    const phase = time * options.frequency * vibrato * Math.PI * 2
    const sample =
      (Math.sin(phase) * 0.62 + Math.sin(phase * 2.01) * 0.22 + Math.sin(phase * 3.02) * 0.08) *
      Math.max(0, Math.min(attack, release)) *
      0.52
    view.setInt16(44 + frame * 2, Math.max(-32767, Math.min(32767, Math.round(sample * 32767))), true)
  }
  return bytes
}

function decodeWavToAudioBuffer(buffer: ArrayBuffer) {
  const view = new DataView(buffer)
  if (readFourCc(view, 0) !== 'RIFF' || readFourCc(view, 8) !== 'WAVE') {
    throw new Error('Unsupported WAV container')
  }

  let fmtOffset = -1
  let dataOffset = -1
  let dataSize = 0
  let offset = 12
  while (offset + 8 <= view.byteLength) {
    const id = readFourCc(view, offset)
    const size = view.getUint32(offset + 4, true)
    if (id === 'fmt ') {
      fmtOffset = offset + 8
    }
    if (id === 'data') {
      dataOffset = offset + 8
      dataSize = size
      break
    }
    offset += 8 + size + (size % 2)
  }

  if (fmtOffset < 0 || dataOffset < 0) {
    throw new Error('Missing WAV fmt or data chunk')
  }

  const audioFormat = view.getUint16(fmtOffset, true)
  const channelCount = view.getUint16(fmtOffset + 2, true)
  const sampleRate = view.getUint32(fmtOffset + 4, true)
  const blockAlign = view.getUint16(fmtOffset + 12, true)
  const bitsPerSample = view.getUint16(fmtOffset + 14, true)
  const frameCount = Math.floor(dataSize / blockAlign)
  const samples = new Float32Array(frameCount)

  for (let frame = 0; frame < frameCount; frame += 1) {
    const sampleOffset = dataOffset + frame * blockAlign
    samples[frame] = readPcmSample(view, sampleOffset, audioFormat, bitsPerSample)
    if (channelCount > 1) {
      samples[frame] /= Math.sqrt(channelCount)
    }
  }

  return {
    sampleRate,
    numberOfChannels: 1,
    length: samples.length,
    duration: samples.length / sampleRate,
    getChannelData(channel: number) {
      if (channel !== 0) {
        throw new Error(`Unexpected channel: ${channel}`)
      }
      return samples
    },
  } as AudioBuffer
}

function measureSamples(samples: Float32Array) {
  let peak = 0
  let sumSquares = 0
  let nonFiniteSampleCount = 0
  for (const sample of samples) {
    if (!Number.isFinite(sample)) {
      nonFiniteSampleCount += 1
      continue
    }
    peak = Math.max(peak, Math.abs(sample))
    sumSquares += sample * sample
  }
  return {
    peak,
    rms: Math.sqrt(sumSquares / Math.max(1, samples.length)),
    nonFiniteSampleCount,
  }
}

function readFourCc(view: DataView, offset: number) {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  )
}

function writeFourCc(bytes: Uint8Array, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    bytes[offset + index] = value.charCodeAt(index)
  }
}

function readPcmSample(view: DataView, offset: number, audioFormat: number, bitsPerSample: number) {
  if (audioFormat === 1 && bitsPerSample === 16) {
    return view.getInt16(offset, true) / 32768
  }
  if (audioFormat === 1 && bitsPerSample === 8) {
    return (view.getUint8(offset) - 128) / 128
  }
  if (audioFormat === 3 && bitsPerSample === 32) {
    return view.getFloat32(offset, true)
  }
  throw new Error(`Unsupported WAV sample format: ${audioFormat}/${bitsPerSample}`)
}

function roundNumber(value: number) {
  return Math.round(value * 100000) / 100000
}

function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function encodeShiftJisSubset(text: string) {
  const kanaBytes = new Map<string, number[]>([
    ['あ', [0x82, 0xa0]],
    ['テ', [0x83, 0x65]],
    ['ス', [0x83, 0x58]],
    ['ト', [0x83, 0x67]],
  ])
  const bytes: number[] = []
  for (const char of text) {
    const mapped = kanaBytes.get(char)
    if (mapped) {
      bytes.push(...mapped)
      continue
    }
    const code = char.charCodeAt(0)
    if (code > 0x7f) {
      throw new Error(`Unsupported Shift-JIS fixture character: ${char}`)
    }
    bytes.push(code)
  }
  return new Uint8Array(bytes)
}
