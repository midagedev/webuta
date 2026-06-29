import JSZip from 'jszip'
import * as yaml from 'js-yaml'
import { midiToHz } from './music'

export type OtoEntry = {
  fileName: string
  path: string
  alias: string
  offsetMs: number
  consonantMs: number
  cutoffMs: number
  preutteranceMs: number
  overlapMs: number
}

export type LoadedVoicebank = {
  id: string
  name: string
  sourceFileName: string
  entries: OtoEntry[]
  aliases: string[]
  sampleCount: number
  wavCount: number
  readSample(entry: OtoEntry): Promise<ArrayBuffer>
}

export type LyricMatchQuality = 'exact' | 'core' | 'contains' | 'fallback'

export type LyricEntryMatch = {
  lyric: string
  targetAlias: string
  candidates: OtoEntry[]
  quality: LyricMatchQuality
}

export type VoicebankCoverage = {
  totalNotes: number
  matchedNotes: number
  fallbackNotes: number
  uniqueLyrics: number
  matchedLyrics: string[]
  fallbackLyrics: string[]
}

type ZipFileMap = Record<string, JSZip.JSZipObject>

export async function loadVoicebankZip(file: File): Promise<LoadedVoicebank> {
  const buffer = await file.arrayBuffer()
  const zip = await loadZipWithFallback(buffer)
  const files = zip.files
  const otoPaths = Object.keys(files).filter((path) => /(^|\/)oto\.ini$/i.test(path) && !files[path].dir)
  const wavPaths = Object.keys(files).filter((path) => /\.wav$/i.test(path) && !files[path].dir)
  if (otoPaths.length === 0) {
    throw new Error('No oto.ini files were found in this voicebank zip.')
  }
  if (wavPaths.length === 0) {
    throw new Error('No WAV samples were found in this voicebank zip.')
  }

  const entries: OtoEntry[] = []
  for (const otoPath of otoPaths) {
    const text = await readZipText(files[otoPath])
    const directory = otoPath.includes('/') ? otoPath.slice(0, otoPath.lastIndexOf('/') + 1) : ''
    for (const entry of parseOtoIni(text, directory, files)) {
      entries.push(entry)
    }
  }

  const characterName = await readCharacterName(files)
  const aliases = Array.from(new Set(entries.map((entry) => entry.alias).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b),
  )

  return {
    id: `${file.name}-${file.size}-${file.lastModified}`,
    name: characterName || inferVoicebankName(file.name),
    sourceFileName: file.name,
    entries,
    aliases,
    sampleCount: entries.length,
    wavCount: wavPaths.length,
    readSample(entry) {
      const sample = files[entry.path] ?? findSample(files, entry.path)
      if (!sample) {
        throw new Error(`Missing sample: ${entry.path}`)
      }
      return sample.async('arraybuffer')
    },
  }
}

async function loadZipWithFallback(buffer: ArrayBuffer) {
  const defaultZip = await JSZip.loadAsync(buffer)
  if (hasVoicebankShape(defaultZip.files) && pathDecodeScore(defaultZip.files) < 1) {
    return defaultZip
  }
  const shiftJisZip = await JSZip.loadAsync(buffer, {
    decodeFileName(bytes) {
      const byteView = Array.isArray(bytes)
        ? Uint8Array.from(bytes.map((value) => value.charCodeAt(0)))
        : bytes
      try {
        return new TextDecoder('shift_jis').decode(byteView)
      } catch {
        return new TextDecoder().decode(byteView)
      }
    },
  })
  if (!hasVoicebankShape(defaultZip.files)) {
    return shiftJisZip
  }
  return pathDecodeScore(shiftJisZip.files) <= pathDecodeScore(defaultZip.files) ? shiftJisZip : defaultZip
}

function hasVoicebankShape(files: ZipFileMap) {
  const paths = Object.keys(files)
  return paths.some((path) => /(^|\/)oto\.ini$/i.test(path)) && paths.some((path) => /\.wav$/i.test(path))
}

function pathDecodeScore(files: ZipFileMap) {
  return Object.keys(files)
    .slice(0, 120)
    .reduce((score, path) => score + (path.match(/\uFFFD/g)?.length ?? 0), 0)
}

export function findEntryForLyric(voicebank: LoadedVoicebank, lyric: string) {
  return findBestEntryForLyric(voicebank, lyric, 60)
}

export function findBestEntryForLyric(voicebank: LoadedVoicebank, lyric: string, targetTone: number) {
  const match = findEntryMatchForLyric(voicebank, lyric)
  return bestEntryCandidate(match.candidates, lyric, targetTone) ?? voicebank.entries[0]
}

export function findEntryCandidatesForLyric(voicebank: LoadedVoicebank, lyric: string) {
  return findEntryMatchForLyric(voicebank, lyric).candidates
}

export function findEntryMatchForLyric(voicebank: LoadedVoicebank, lyric: string): LyricEntryMatch {
  const normalized = normalizeLyric(lyric)
  const likelyAlias = lyricToLikelyJapaneseAlias(normalized)
  const searchKeys = Array.from(new Set([normalized, likelyAlias].filter(Boolean)))

  const exact = voicebank.entries.filter((entry) =>
    searchKeys.some((key) => normalizeLyric(entry.alias) === key),
  )
  if (exact.length > 0) {
    return {
      lyric,
      targetAlias: likelyAlias,
      candidates: exact,
      quality: 'exact',
    }
  }

  const coreExact = voicebank.entries.filter((entry) =>
    searchKeys.some((key) => normalizeAliasCore(entry.alias) === key),
  )
  if (coreExact.length > 0) {
    return {
      lyric,
      targetAlias: likelyAlias,
      candidates: coreExact,
      quality: 'core',
    }
  }

  const contains = voicebank.entries.filter((entry) =>
    searchKeys.some((key) => normalizeLyric(entry.alias).includes(key)),
  )
  if (contains.length > 0) {
    return {
      lyric,
      targetAlias: likelyAlias,
      candidates: contains,
      quality: 'contains',
    }
  }

  return {
    lyric,
    targetAlias: likelyAlias,
    candidates: voicebank.entries,
    quality: 'fallback',
  }
}

export function analyzeVoicebankCoverage(
  voicebank: LoadedVoicebank,
  notes: Array<{ lyric: string }>,
): VoicebankCoverage {
  const lyricMatches = new Map<string, LyricEntryMatch>()
  let matchedNotes = 0
  for (const note of notes) {
    const lyric = normalizeLyric(note.lyric)
    const match = lyricMatches.get(lyric) ?? findEntryMatchForLyric(voicebank, lyric)
    lyricMatches.set(lyric, match)
    if (match.quality !== 'fallback') {
      matchedNotes += 1
    }
  }

  const matchedLyrics = [...lyricMatches.values()]
    .filter((match) => match.quality !== 'fallback')
    .map((match) => match.lyric)
  const fallbackLyrics = [...lyricMatches.values()]
    .filter((match) => match.quality === 'fallback')
    .map((match) => match.lyric)

  return {
    totalNotes: notes.length,
    matchedNotes,
    fallbackNotes: notes.length - matchedNotes,
    uniqueLyrics: lyricMatches.size,
    matchedLyrics,
    fallbackLyrics,
  }
}

export function estimateEntryBaseTone(entry: OtoEntry) {
  const match = `${entry.fileName} ${entry.path}`.match(/([A-Ga-g])([#b]?)(\d)/)
  if (!match) {
    return 60
  }
  const [, note, accidental, octaveText] = match
  const semitone = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[note.toUpperCase() as 'C']
  const accidentalOffset = accidental === '#' ? 1 : accidental === 'b' ? -1 : 0
  return (Number(octaveText) + 1) * 12 + semitone + accidentalOffset
}

export function playbackRateForTone(entry: OtoEntry, targetTone: number) {
  return midiToHz(targetTone) / midiToHz(estimateEntryBaseTone(entry))
}

function bestEntryCandidate(entries: OtoEntry[], lyric: string, targetTone: number) {
  const normalized = normalizeLyric(lyric)
  const likelyAlias = lyricToLikelyJapaneseAlias(normalized)
  const searchKeys = Array.from(new Set([normalized, likelyAlias].filter(Boolean)))
  return entries
    .map((entry, index) => ({
      entry,
      score: entrySelectionScore(entry, searchKeys, targetTone, index),
    }))
    .sort((a, b) => a.score - b.score)[0]?.entry
}

function entrySelectionScore(entry: OtoEntry, searchKeys: string[], targetTone: number, index: number) {
  const alias = normalizeLyric(entry.alias)
  const core = normalizeAliasCore(entry.alias)
  const path = normalizeLyric(entry.path)
  const matchScore = searchKeys.reduce((best, key) => {
    if (alias === key) {
      return Math.min(best, 0)
    }
    if (core === key) {
      return Math.min(best, 12)
    }
    if (alias.includes(key)) {
      return Math.min(best, 52)
    }
    return best
  }, 100)

  const prefixPenalty = /^[-*]\s/.test(alias) ? 5 : 0
  const vcvPenalty = /^[a-zぁ-んァ-ンー]\s/.test(alias) ? 18 : 0
  const pathPenalty = voicebankStylePenalty(path)
  const pitchPenalty = hasExplicitPitch(entry) ? Math.abs(estimateEntryBaseTone(entry) - targetTone) * 1.7 : 0
  return matchScore + prefixPenalty + vcvPenalty + pathPenalty + pitchPenalty + index / 10000
}

function voicebankStylePenalty(path: string) {
  let penalty = 0
  if (path.includes('単独音')) {
    penalty -= 10
  }
  if (path.includes('連続音')) {
    penalty += 16
  }
  if (path.includes('ささやき')) {
    penalty += 20
  }
  if (path.includes('エッジ')) {
    penalty += 18
  }
  if (path.includes('力み')) {
    penalty += 14
  }
  if (path.includes('叫び')) {
    penalty += 16
  }
  if (path.includes('エクストラ')) {
    penalty += 26
  }
  return penalty
}

function hasExplicitPitch(entry: OtoEntry) {
  return /[A-Ga-g][#b]?\d/.test(`${entry.fileName} ${entry.path}`)
}

function parseOtoIni(text: string, directory: string, files: ZipFileMap) {
  const entries: OtoEntry[] = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || !line.includes('=')) {
      continue
    }
    const [fileNameRaw, configRaw] = splitOnce(line, '=')
    const values = configRaw.split(',')
    const fileName = fileNameRaw.trim()
    const alias = (values[0] ?? '').trim() || fileName.replace(/\.wav$/i, '')
    const path = resolveSamplePath(directory, fileName, files)
    if (!path) {
      continue
    }
    entries.push({
      fileName,
      path,
      alias,
      offsetMs: parseNumber(values[1]),
      consonantMs: parseNumber(values[2]),
      cutoffMs: parseNumber(values[3]),
      preutteranceMs: parseNumber(values[4]),
      overlapMs: parseNumber(values[5]),
    })
  }
  return entries
}

async function readCharacterName(files: ZipFileMap) {
  const characterPath = Object.keys(files).find((path) => /(^|\/)character\.ya?ml$/i.test(path) && !files[path].dir)
  if (characterPath) {
    try {
      const text = await readZipText(files[characterPath])
      const data = yaml.load(text)
      if (typeof data === 'object' && data && 'name' in data && typeof data.name === 'string') {
        return data.name
      }
    } catch {
      return undefined
    }
  }
  return undefined
}

async function readZipText(file: JSZip.JSZipObject) {
  const buffer = await file.async('arraybuffer')
  return decodeText(buffer)
}

function decodeText(buffer: ArrayBuffer) {
  const candidates = ['utf-8', 'shift_jis']
    .map((encoding) => {
      try {
        const text = new TextDecoder(encoding).decode(buffer)
        return { text, score: textDecodeScore(text) }
      } catch {
        return null
      }
    })
    .filter((candidate): candidate is { text: string; score: number } => candidate !== null)
  return candidates.sort((a, b) => a.score - b.score)[0]?.text ?? new TextDecoder().decode(buffer)
}

function textDecodeScore(text: string) {
  return (text.match(/\uFFFD/g)?.length ?? 0) + (text.match(/[�]/g)?.length ?? 0)
}

function resolveSamplePath(directory: string, fileName: string, files: ZipFileMap) {
  const direct = `${directory}${fileName}`
  if (files[direct]) {
    return direct
  }
  return Object.keys(files).find((path) => path.endsWith(`/${fileName}`) || path === fileName)
}

function findSample(files: ZipFileMap, path: string) {
  return files[path] ?? files[decodeURIComponent(path)]
}

function splitOnce(text: string, separator: string) {
  const index = text.indexOf(separator)
  return [text.slice(0, index), text.slice(index + separator.length)]
}

function parseNumber(value: string | undefined) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizeLyric(lyric: string) {
  return lyric.trim().toLowerCase()
}

function normalizeAliasCore(alias: string) {
  return normalizeLyric(alias)
    .replace(/^[-*]\s+/, '')
    .replace(/^[a-zぁ-んァ-ンー]\s+/, '')
    .replace(/[囁力↑↓'’]+$/g, '')
}

function lyricToLikelyJapaneseAlias(lyric: string) {
  const map: Record<string, string> = {
    a: 'あ',
    i: 'い',
    u: 'う',
    e: 'え',
    o: 'お',
    la: 'ら',
    li: 'り',
    lu: 'る',
    le: 'れ',
    lo: 'ろ',
    ra: 'ら',
    ri: 'り',
    ru: 'る',
    re: 'れ',
    ro: 'ろ',
    na: 'な',
    ni: 'に',
    nu: 'ぬ',
    ne: 'ね',
    no: 'の',
    ka: 'か',
    ki: 'き',
    ku: 'く',
    ke: 'け',
    ko: 'こ',
    ga: 'が',
    gi: 'ぎ',
    gu: 'ぐ',
    ge: 'げ',
    go: 'ご',
    sa: 'さ',
    si: 'し',
    shi: 'し',
    su: 'す',
    se: 'せ',
    so: 'そ',
    za: 'ざ',
    ji: 'じ',
    zu: 'ず',
    ze: 'ぜ',
    zo: 'ぞ',
    ta: 'た',
    ti: 'ち',
    chi: 'ち',
    tu: 'つ',
    tsu: 'つ',
    te: 'て',
    to: 'と',
    da: 'だ',
    di: 'ぢ',
    du: 'づ',
    de: 'で',
    do: 'ど',
    ha: 'は',
    hi: 'ひ',
    fu: 'ふ',
    he: 'へ',
    ho: 'ほ',
    ba: 'ば',
    bi: 'び',
    bu: 'ぶ',
    be: 'べ',
    bo: 'ぼ',
    pa: 'ぱ',
    pi: 'ぴ',
    pu: 'ぷ',
    pe: 'ぺ',
    po: 'ぽ',
    ma: 'ま',
    mi: 'み',
    mu: 'む',
    me: 'め',
    mo: 'も',
    ya: 'や',
    yu: 'ゆ',
    yo: 'よ',
    wa: 'わ',
    wo: 'を',
    n: 'ん',
    아: 'あ',
    이: 'い',
    우: 'う',
    으: 'う',
    에: 'え',
    애: 'え',
    오: 'お',
    어: 'お',
    라: 'ら',
    리: 'り',
    루: 'る',
    르: 'る',
    레: 'れ',
    래: 'れ',
    로: 'ろ',
    러: 'ろ',
    나: 'な',
    니: 'に',
    누: 'ぬ',
    느: 'ぬ',
    네: 'ね',
    내: 'ね',
    노: 'の',
    너: 'の',
    카: 'か',
    키: 'き',
    쿠: 'く',
    크: 'く',
    케: 'け',
    캐: 'け',
    코: 'こ',
    커: 'こ',
    가: 'が',
    기: 'ぎ',
    구: 'ぐ',
    그: 'ぐ',
    게: 'げ',
    개: 'げ',
    고: 'ご',
    거: 'ご',
    사: 'さ',
    시: 'し',
    수: 'す',
    스: 'す',
    세: 'せ',
    새: 'せ',
    소: 'そ',
    서: 'そ',
    자: 'ざ',
    지: 'じ',
    주: 'ず',
    즈: 'ず',
    제: 'ぜ',
    재: 'ぜ',
    조: 'ぞ',
    저: 'ぞ',
    타: 'た',
    치: 'ち',
    추: 'つ',
    츠: 'つ',
    테: 'て',
    태: 'て',
    토: 'と',
    터: 'と',
    다: 'だ',
    디: 'ぢ',
    두: 'づ',
    드: 'づ',
    데: 'で',
    대: 'で',
    도: 'ど',
    더: 'ど',
    하: 'は',
    히: 'ひ',
    후: 'ふ',
    흐: 'ふ',
    헤: 'へ',
    해: 'へ',
    호: 'ほ',
    허: 'ほ',
    바: 'ば',
    비: 'び',
    부: 'ぶ',
    브: 'ぶ',
    베: 'べ',
    배: 'べ',
    보: 'ぼ',
    버: 'ぼ',
    파: 'ぱ',
    피: 'ぴ',
    푸: 'ぷ',
    프: 'ぷ',
    페: 'ぺ',
    패: 'ぺ',
    포: 'ぽ',
    퍼: 'ぽ',
    마: 'ま',
    미: 'み',
    무: 'む',
    므: 'む',
    메: 'め',
    매: 'め',
    모: 'も',
    머: 'も',
    야: 'や',
    유: 'ゆ',
    요: 'よ',
    와: 'わ',
    워: 'を',
    응: 'ん',
  }
  return map[lyric] ?? lyric
}

function inferVoicebankName(fileName: string) {
  if (/teto/i.test(fileName)) {
    return 'Kasane Teto UTAU'
  }
  return fileName.replace(/\.[^.]+$/, '')
}
