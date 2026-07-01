import JSZip from 'jszip'
import * as yaml from 'js-yaml'
import { midiToHz, toneName } from './music'

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
  metadata: VoicebankMetadata
  prefixMaps?: VoicebankPrefixMap[]
  entries: OtoEntry[]
  aliases: string[]
  sampleCount: number
  wavCount: number
  readSample(entry: OtoEntry): Promise<ArrayBuffer>
}

export type VoicebankTextMetadata = {
  path: string
  excerpt: string
}

export type VoicebankOriginMetadata = {
  path: string
  type?: string
  method?: string
  synthesisProfile?: string
  parseError?: string
  generatedSynthetic: boolean
  noHumanRecordingSource: boolean
  noPublicOrPrivateRecordedDatasetSource: boolean
  noThirdPartySingerOrCharacterSource: boolean
  noTtsOrModelCheckpointOutput: boolean
}

export type VoicebankMetadata = {
  characterPath?: string
  readme?: VoicebankTextMetadata
  license?: VoicebankTextMetadata
  manifestPath?: string
  origin?: VoicebankOriginMetadata
  prefixMapPaths?: string[]
  licenseStatus: 'license-file-present' | 'license-file-missing'
}

export type VoicebankPrefixMapRule = {
  noteName: string
  tone: number
  prefix: string
  suffix: string
}

export type VoicebankPrefixMap = {
  path: string
  directory: string
  rules: VoicebankPrefixMapRule[]
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

export type VoicebankRenderWarningKind = 'missing-alias' | 'pitch-shift' | 'missing-coda-tail'

export type VoicebankRenderWarning = {
  noteId: string
  lyric: string
  tone: number
  kind: VoicebankRenderWarningKind
  severity: 'warning' | 'error'
  message: string
  detail: string
  entryAlias?: string
  entryFileName?: string
  semitoneShift?: number
}

export type VoicebankRenderWarningReport = {
  totalNotes: number
  warningCount: number
  errorCount: number
  warnings: VoicebankRenderWarning[]
}

type ZipFileMap = Record<string, JSZip.JSZipObject>

export type VoicebankZipSafetyLimits = {
  maxZipBytes: number
  maxFiles: number
  maxOtoFiles: number
  maxWavFiles: number
  maxSingleOtoBytes: number
  maxSingleMetadataBytes: number
  maxSingleWavBytes: number
  maxTotalWavBytes: number
}

export type LoadVoicebankZipOptions = {
  safetyLimits?: Partial<VoicebankZipSafetyLimits>
}

export const DEFAULT_VOICEBANK_ZIP_SAFETY_LIMITS: VoicebankZipSafetyLimits = {
  maxZipBytes: 768 * 1024 * 1024,
  maxFiles: 12000,
  maxOtoFiles: 128,
  maxWavFiles: 6000,
  maxSingleOtoBytes: 4 * 1024 * 1024,
  maxSingleMetadataBytes: 512 * 1024,
  maxSingleWavBytes: 32 * 1024 * 1024,
  maxTotalWavBytes: 1536 * 1024 * 1024,
}

export async function loadVoicebankZip(file: File, options: LoadVoicebankZipOptions = {}): Promise<LoadedVoicebank> {
  const safetyLimits = resolveVoicebankZipSafetyLimits(options.safetyLimits)
  if (file.size > safetyLimits.maxZipBytes) {
    throw new Error(
      `Voicebank zip is too large (${formatBytes(file.size)}). Maximum supported import size is ${formatBytes(safetyLimits.maxZipBytes)}.`,
    )
  }

  const buffer = await file.arrayBuffer()
  const zip = await loadZipWithFallback(buffer)
  const files = zip.files
  const otoPaths = Object.keys(files).filter((path) => /(^|\/)oto\.ini$/i.test(path) && !files[path].dir)
  const wavPaths = Object.keys(files).filter((path) => /\.wav$/i.test(path) && !files[path].dir)
  validateVoicebankZipSafety(file, files, otoPaths, wavPaths, safetyLimits)
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

  const prefixMaps = await readPrefixMaps(files, safetyLimits)
  const character = await readCharacterInfo(files, safetyLimits)
  const metadata = await readVoicebankMetadata(files, safetyLimits, character.path, prefixMaps)
  const aliases = Array.from(new Set(entries.map((entry) => entry.alias).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b),
  )

  return {
    id: `${file.name}-${file.size}-${file.lastModified}`,
    name: character.name || inferVoicebankName(file.name),
    sourceFileName: file.name,
    metadata,
    prefixMaps,
    entries,
    aliases,
    sampleCount: entries.length,
    wavCount: wavPaths.length,
    readSample(entry) {
      const sample = files[entry.path] ?? findSample(files, entry.path)
      if (!sample) {
        throw new Error(`Missing sample: ${entry.path}`)
      }
      validateZipMemberSize(sample, safetyLimits.maxSingleWavBytes, `WAV sample ${entry.path}`)
      return sample.async('arraybuffer')
    },
  }
}

function resolveVoicebankZipSafetyLimits(overrides: Partial<VoicebankZipSafetyLimits> = {}) {
  return {
    ...DEFAULT_VOICEBANK_ZIP_SAFETY_LIMITS,
    ...overrides,
  }
}

function validateVoicebankZipSafety(
  file: File,
  files: ZipFileMap,
  otoPaths: string[],
  wavPaths: string[],
  limits: VoicebankZipSafetyLimits,
) {
  const paths = Object.keys(files)
  if (paths.length > limits.maxFiles) {
    throw new Error(
      `Voicebank zip has too many entries (${paths.length}). Maximum supported entry count is ${limits.maxFiles}.`,
    )
  }
  const unsafePath = paths.find((path) => isUnsafeZipPath(path))
  if (unsafePath) {
    throw new Error(`Voicebank zip contains an unsafe path: ${unsafePath}`)
  }
  if (otoPaths.length > limits.maxOtoFiles) {
    throw new Error(
      `Voicebank zip has too many oto.ini files (${otoPaths.length}). Maximum supported oto.ini count is ${limits.maxOtoFiles}.`,
    )
  }
  if (wavPaths.length > limits.maxWavFiles) {
    throw new Error(
      `Voicebank zip has too many WAV samples (${wavPaths.length}). Maximum supported WAV count is ${limits.maxWavFiles}.`,
    )
  }

  for (const otoPath of otoPaths) {
    validateZipMemberSize(files[otoPath], limits.maxSingleOtoBytes, `oto.ini ${otoPath}`)
  }

  let totalWavBytes = 0
  for (const wavPath of wavPaths) {
    const wavSize = zipMemberSize(files[wavPath])
    if (wavSize === undefined) {
      continue
    }
    if (wavSize > limits.maxSingleWavBytes) {
      throw new Error(
        `WAV sample ${wavPath} is too large (${formatBytes(wavSize)}). Maximum supported sample size is ${formatBytes(limits.maxSingleWavBytes)}.`,
      )
    }
    totalWavBytes += wavSize
  }
  if (totalWavBytes > limits.maxTotalWavBytes) {
    throw new Error(
      `Voicebank zip expands to too much WAV audio (${formatBytes(totalWavBytes)}). Maximum supported WAV payload is ${formatBytes(limits.maxTotalWavBytes)}.`,
    )
  }

  if (file.size > 0 && totalWavBytes > 0 && totalWavBytes / file.size > 20) {
    throw new Error('Voicebank zip looks unusually compressed and was blocked for browser safety.')
  }
}

function validateZipMemberSize(file: JSZip.JSZipObject, maxBytes: number, label: string) {
  const size = zipMemberSize(file)
  if (size !== undefined && size > maxBytes) {
    throw new Error(`${label} is too large (${formatBytes(size)}). Maximum supported size is ${formatBytes(maxBytes)}.`)
  }
}

function zipMemberSize(file: JSZip.JSZipObject) {
  const metadata = (file as JSZip.JSZipObject & {
    _data?: {
      compressedSize?: number
      uncompressedSize?: number
    }
  })._data
  const size = metadata?.uncompressedSize ?? metadata?.compressedSize
  return typeof size === 'number' && Number.isFinite(size) && size >= 0 ? size : undefined
}

function isUnsafeZipPath(path: string) {
  const normalized = path.replaceAll('\\', '/')
  return (
    normalized.startsWith('/') ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.split('/').some((segment) => segment === '..')
  )
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${bytes} B`
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
  const match = findEntryMatchForLyric(voicebank, lyric, targetTone)
  return bestEntryCandidate(voicebank, match.candidates, lyric, targetTone) ?? voicebank.entries[0]
}

export function findEntryCandidatesForLyric(voicebank: LoadedVoicebank, lyric: string) {
  return findEntryMatchForLyric(voicebank, lyric).candidates
}

export function findCodaTailEntryForLyric(voicebank: LoadedVoicebank, lyric: string, targetTone: number) {
  const searchKeys = hangulCodaTailAliases(lyric)
  if (searchKeys.length === 0) {
    return undefined
  }
  const candidates = voicebank.entries.filter((entry) => {
    const alias = normalizeLyric(entry.alias)
    const core = normalizeAliasCore(entry.alias)
    return searchKeys.some((key) => alias === key || core === key)
  })
  return bestEntryCandidate(voicebank, candidates, lyric, targetTone)
}

export function findSustainEntryForLyric(voicebank: LoadedVoicebank, lyric: string, targetTone: number) {
  const sustainLyric = hangulSyllableWithoutCoda(normalizeLyric(lyric))
  if (!sustainLyric) {
    return undefined
  }
  const match = findEntryMatchForLyric(voicebank, sustainLyric, targetTone)
  if (match.quality === 'fallback') {
    return undefined
  }
  return bestEntryCandidate(voicebank, match.candidates, sustainLyric, targetTone)
}

export function findEntryMatchForLyric(voicebank: LoadedVoicebank, lyric: string, targetTone?: number): LyricEntryMatch {
  const normalized = normalizeLyric(lyric)
  const likelyAliases = lyricToLikelyJapaneseAliases(normalized)
  const hangulCvAlias = hangulSyllableWithoutCoda(normalized)
  const likelyCvAliases = hangulCvAlias ? lyricToLikelyJapaneseAliases(hangulCvAlias) : []
  const baseKeys = Array.from(new Set([normalized, ...likelyAliases, hangulCvAlias, ...likelyCvAliases].filter(Boolean)))
  const targetKeys = Array.from(new Set([...likelyAliases, normalized, ...likelyCvAliases, hangulCvAlias].filter(Boolean)))
  const mappedKeys = targetTone === undefined ? [] : prefixMappedAliasesForKeys(voicebank, targetKeys, targetTone)
  const searchKeys = Array.from(new Set([...mappedKeys, ...baseKeys].filter(Boolean)))
  const targetAlias = mappedKeys[0] ?? likelyAliases[0] ?? normalized

  const exact = voicebank.entries.filter((entry) =>
    searchKeys.some((key) => normalizeLyric(entry.alias) === key),
  )
  if (exact.length > 0) {
    return {
      lyric,
      targetAlias,
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
      targetAlias,
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
      targetAlias,
      candidates: contains,
      quality: 'contains',
    }
  }

  return {
    lyric,
    targetAlias,
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

export function analyzeVoicebankRenderWarnings(
  voicebank: LoadedVoicebank,
  notes: Array<{ id?: string; lyric: string; tone: number; start?: number }>,
  options: { maxPitchShiftSemitones?: number } = {},
): VoicebankRenderWarningReport {
  const maxPitchShiftSemitones = options.maxPitchShiftSemitones ?? 9
  const warnings: VoicebankRenderWarning[] = []

  for (const [index, note] of notes.entries()) {
    const noteId = note.id ?? `${index}`
    const lyric = normalizeLyric(note.lyric)
    const match = findEntryMatchForLyric(voicebank, lyric)
    const sustainEntry = findSustainEntryForLyric(voicebank, lyric, note.tone)
    const selectedEntry = sustainEntry ?? findBestEntryForLyric(voicebank, lyric, note.tone)
    const codaTailEntry = findCodaTailEntryForLyric(voicebank, lyric, note.tone)

    if (match.quality === 'fallback') {
      warnings.push({
        noteId,
        lyric,
        tone: note.tone,
        kind: 'missing-alias',
        severity: 'error',
        message: `${lyric} alias 없음`,
        detail: `${lyric} 노트가 oto.ini alias에 연결되지 않아 fallback 샘플로 렌더됩니다.`,
      })
      continue
    }

    if (hangulCodaTailAliases(lyric).length > 0 && !codaTailEntry) {
      warnings.push({
        noteId,
        lyric,
        tone: note.tone,
        kind: 'missing-coda-tail',
        severity: 'warning',
        message: `${lyric} 받침 tail 없음`,
        detail: `${lyric} 노트는 받침 전용 VC tail이 없어 긴 음에서 받침 처리가 불안정할 수 있습니다.`,
        entryAlias: selectedEntry?.alias,
        entryFileName: selectedEntry?.fileName,
      })
    }

    if (selectedEntry) {
      const baseTone = estimateEntryBaseTone(selectedEntry)
      const semitoneShift = note.tone - baseTone
      if (Math.abs(semitoneShift) > maxPitchShiftSemitones) {
        warnings.push({
          noteId,
          lyric,
          tone: note.tone,
          kind: 'pitch-shift',
          severity: 'warning',
          message: `${lyric} ${Math.abs(semitoneShift)}반음 이동`,
          detail: `${selectedEntry.alias} ${toneName(baseTone)} 샘플을 ${toneName(note.tone)}로 크게 피치시프트합니다.`,
          entryAlias: selectedEntry.alias,
          entryFileName: selectedEntry.fileName,
          semitoneShift,
        })
      }
    }
  }

  return {
    totalNotes: notes.length,
    warningCount: warnings.length,
    errorCount: warnings.filter((warning) => warning.severity === 'error').length,
    warnings: warnings.sort((a, b) => {
      const severityScore = (warning: VoicebankRenderWarning) => (warning.severity === 'error' ? 0 : 1)
      return severityScore(a) - severityScore(b)
    }),
  }
}

export function estimateEntryBaseTone(entry: OtoEntry) {
  const match = `${entry.fileName} ${entry.path}`.match(/([A-Ga-g])([#b]?)(\d)/)
  if (!match) {
    return 60
  }
  return noteNameToMidi(`${match[1]}${match[2]}${match[3]}`) ?? 60
}

export function playbackRateForTone(entry: OtoEntry, targetTone: number) {
  return midiToHz(targetTone) / midiToHz(estimateEntryBaseTone(entry))
}

function bestEntryCandidate(voicebank: LoadedVoicebank, entries: OtoEntry[], lyric: string, targetTone: number) {
  const normalized = normalizeLyric(lyric)
  const likelyAliases = lyricToLikelyJapaneseAliases(normalized)
  const searchKeys = Array.from(new Set([normalized, ...likelyAliases].filter(Boolean)))
  const mappedKeys = prefixMappedAliasesForKeys(voicebank, searchKeys, targetTone)
  return entries
    .map((entry, index) => ({
      entry,
      score: entrySelectionScore(entry, searchKeys, mappedKeys, targetTone, index),
    }))
    .sort((a, b) => a.score - b.score)[0]?.entry
}

function entrySelectionScore(
  entry: OtoEntry,
  searchKeys: string[],
  mappedKeys: string[],
  targetTone: number,
  index: number,
) {
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
  const prefixMapPenalty =
    mappedKeys.length > 0 && !mappedKeys.some((key) => alias === key || core === key) ? 8 : 0
  const vcvPenalty = /^[a-zぁ-んァ-ンー]\s/.test(alias) ? 18 : 0
  const pathPenalty = voicebankStylePenalty(path)
  const pitchPenalty = hasExplicitPitch(entry) ? Math.abs(estimateEntryBaseTone(entry) - targetTone) * 1.7 : 0
  return matchScore + prefixMapPenalty + prefixPenalty + vcvPenalty + pathPenalty + pitchPenalty + index / 10000
}

function prefixMappedAliasesForKeys(voicebank: LoadedVoicebank, keys: string[], targetTone: number) {
  const affixes = prefixMapAffixesForTone(voicebank, targetTone)
  if (affixes.length === 0) {
    return []
  }
  return Array.from(
    new Set(
      affixes.flatMap((affix) =>
        keys.map((key) => normalizeLyric(`${affix.prefix}${key}${affix.suffix}`)).filter(Boolean),
      ),
    ),
  )
}

function prefixMapAffixesForTone(voicebank: LoadedVoicebank, targetTone: number) {
  return (voicebank.prefixMaps ?? [])
    .map((prefixMap) => closestPrefixMapRule(prefixMap, targetTone))
    .filter((rule): rule is VoicebankPrefixMapRule => Boolean(rule && (rule.prefix || rule.suffix)))
}

function closestPrefixMapRule(prefixMap: VoicebankPrefixMap, targetTone: number) {
  return prefixMap.rules
    .map((rule, index) => ({
      rule,
      score: Math.abs(rule.tone - targetTone) + index / 10000,
    }))
    .sort((a, b) => a.score - b.score)[0]?.rule
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

async function readCharacterInfo(files: ZipFileMap, limits: VoicebankZipSafetyLimits) {
  const characterPath = Object.keys(files).find((path) => /(^|\/)character\.ya?ml$/i.test(path) && !files[path].dir)
  if (characterPath) {
    try {
      validateZipMemberSize(files[characterPath], limits.maxSingleMetadataBytes, `character metadata ${characterPath}`)
      const text = await readZipText(files[characterPath])
      const data = yaml.load(text)
      if (typeof data === 'object' && data && 'name' in data && typeof data.name === 'string') {
        return {
          path: characterPath,
          name: data.name,
        }
      }
    } catch {
      return {
        path: characterPath,
        name: undefined,
      }
    }
  }
  return {
    path: undefined,
    name: undefined,
  }
}

async function readVoicebankMetadata(
  files: ZipFileMap,
  limits: VoicebankZipSafetyLimits,
  characterPath: string | undefined,
  prefixMaps: VoicebankPrefixMap[],
): Promise<VoicebankMetadata> {
  const licensePath = findTextAssetPath(files, /(^|\/)(license|licence|terms|readme_license)\.(txt|md)$/i)
  const readmePath = findTextAssetPath(files, /(^|\/)(readme|README)\.(txt|md)$/)
  const manifestPath = Object.keys(files).find((path) => /(^|\/)[^/]+\.manifest\.json$/i.test(path) && !files[path].dir)
  const license = licensePath ? await readTextMetadata(files[licensePath], licensePath, limits) : undefined
  const readme = readmePath ? await readTextMetadata(files[readmePath], readmePath, limits) : undefined
  const origin = manifestPath ? await readVoicebankOrigin(files[manifestPath], manifestPath, limits) : undefined

  return {
    characterPath,
    readme,
    license,
    manifestPath,
    origin,
    prefixMapPaths: prefixMaps.map((prefixMap) => prefixMap.path),
    licenseStatus: license ? 'license-file-present' : 'license-file-missing',
  }
}

async function readVoicebankOrigin(
  file: JSZip.JSZipObject,
  path: string,
  limits: VoicebankZipSafetyLimits,
): Promise<VoicebankOriginMetadata> {
  validateZipMemberSize(file, limits.maxSingleMetadataBytes, `voicebank manifest ${path}`)
  const emptyOrigin = {
    path,
    generatedSynthetic: false,
    noHumanRecordingSource: false,
    noPublicOrPrivateRecordedDatasetSource: false,
    noThirdPartySingerOrCharacterSource: false,
    noTtsOrModelCheckpointOutput: false,
  }
  try {
    const manifest = JSON.parse(await readZipText(file)) as Record<string, unknown>
    const sourceLineage = isObjectRecord(manifest.sourceLineage) ? manifest.sourceLineage : {}
    const synthesis = isObjectRecord(manifest.synthesis) ? manifest.synthesis : {}
    const type = stringValue(manifest.type)
    const method = stringValue(sourceLineage.method)
    const synthesisProfile = stringValue(synthesis.profile)
    return {
      ...emptyOrigin,
      type,
      method,
      synthesisProfile,
      generatedSynthetic: Boolean(type?.includes('generated-synthetic') || method === 'deterministic-dsp-only'),
      noHumanRecordingSource: sourceLineage.noHumanRecordingSource === true,
      noPublicOrPrivateRecordedDatasetSource: sourceLineage.noPublicOrPrivateRecordedDatasetSource === true,
      noThirdPartySingerOrCharacterSource: sourceLineage.noThirdPartySingerOrCharacterSource === true,
      noTtsOrModelCheckpointOutput: sourceLineage.noTtsOrModelCheckpointOutput === true,
    }
  } catch (error) {
    return {
      ...emptyOrigin,
      parseError: error instanceof Error ? error.message : String(error),
    }
  }
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

async function readPrefixMaps(files: ZipFileMap, limits: VoicebankZipSafetyLimits): Promise<VoicebankPrefixMap[]> {
  const prefixMapPaths = Object.keys(files)
    .filter((path) => /(^|\/)prefix\.map$/i.test(path) && !files[path].dir)
    .sort((a, b) => pathDepth(a) - pathDepth(b) || a.localeCompare(b))
  const prefixMaps: VoicebankPrefixMap[] = []
  for (const path of prefixMapPaths) {
    validateZipMemberSize(files[path], limits.maxSingleMetadataBytes, `prefix.map ${path}`)
    const text = await readZipText(files[path])
    const rules = parsePrefixMap(text)
    if (rules.length === 0) {
      continue
    }
    prefixMaps.push({
      path,
      directory: path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '',
      rules,
    })
  }
  return prefixMaps
}

function parsePrefixMap(text: string): VoicebankPrefixMapRule[] {
  const rules: VoicebankPrefixMapRule[] = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\uFEFF/g, '')
    if (!line.trim() || line.trimStart().startsWith('#')) {
      continue
    }
    const values = line.includes('\t') ? line.split('\t') : line.trim().split(/\s+/)
    const noteName = (values[0] ?? '').trim()
    const tone = noteNameToMidi(noteName)
    if (tone === undefined) {
      continue
    }
    rules.push({
      noteName,
      tone,
      prefix: values[1] ?? '',
      suffix: values.slice(2).join('\t') || '',
    })
  }
  return rules
}

function findTextAssetPath(files: ZipFileMap, pattern: RegExp) {
  return Object.keys(files)
    .filter((path) => pattern.test(path) && !files[path].dir)
    .sort((a, b) => pathDepth(a) - pathDepth(b) || a.localeCompare(b))[0]
}

async function readTextMetadata(file: JSZip.JSZipObject, path: string, limits: VoicebankZipSafetyLimits) {
  validateZipMemberSize(file, limits.maxSingleMetadataBytes, `voicebank metadata ${path}`)
  const text = await readZipText(file)
  return {
    path,
    excerpt: textExcerpt(text),
  }
}

function pathDepth(path: string) {
  return path.split('/').length
}

function textExcerpt(text: string, maxLength = 320) {
  const normalized = text.split('\u0000').join('').replace(/\s+/g, ' ').trim()
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength).trimEnd()}...` : normalized
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

function noteNameToMidi(noteName: string) {
  const match = noteName.trim().match(/^([A-Ga-g])([#b♯♭]?)(-?\d)$/)
  if (!match) {
    return undefined
  }
  const [, note, accidental, octaveText] = match
  const semitone = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[note.toUpperCase() as 'C']
  const accidentalOffset = accidental === '#' || accidental === '♯' ? 1 : accidental === 'b' || accidental === '♭' ? -1 : 0
  return (Number(octaveText) + 1) * 12 + semitone + accidentalOffset
}

function normalizeLyric(lyric: string) {
  return katakanaToHiragana(lyric.trim().toLowerCase())
}

function katakanaToHiragana(text: string) {
  return text.replace(/[\u30A1-\u30F6]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60))
}

function normalizeAliasCore(alias: string) {
  return normalizeLyric(alias)
    .replace(/^[-*]\s+/, '')
    .replace(/^[a-zぁ-んァ-ンー]\s+/, '')
    .replace(/[囁力↑↓'’]+$/g, '')
}

function lyricToLikelyJapaneseAliases(lyric: string) {
  const map: Record<string, string | string[]> = {
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
    kya: 'きゃ',
    kyu: 'きゅ',
    kyo: 'きょ',
    gya: 'ぎゃ',
    gyu: 'ぎゅ',
    gyo: 'ぎょ',
    kwa: 'くぁ',
    kwi: 'くぃ',
    kwe: 'くぇ',
    kwo: 'くぉ',
    gwa: 'ぐぁ',
    gwi: 'ぐぃ',
    gwe: 'ぐぇ',
    gwo: 'ぐぉ',
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
    sya: 'しゃ',
    syu: 'しゅ',
    syo: 'しょ',
    sha: 'しゃ',
    shu: 'しゅ',
    she: 'しぇ',
    sho: 'しょ',
    ja: 'じゃ',
    ju: 'じゅ',
    jo: 'じょ',
    jya: 'じゃ',
    jyu: 'じゅ',
    jyo: 'じょ',
    je: 'じぇ',
    ta: 'た',
    ti: ['ち', 'てぃ'],
    chi: 'ち',
    tu: ['つ', 'とぅ'],
    tsu: 'つ',
    te: 'て',
    to: 'と',
    tsa: 'つぁ',
    tsi: 'つぃ',
    tse: 'つぇ',
    tso: 'つぉ',
    thi: 'てぃ',
    tei: 'てぃ',
    twu: 'とぅ',
    da: 'だ',
    di: ['ぢ', 'でぃ'],
    du: ['づ', 'どぅ'],
    de: 'で',
    do: 'ど',
    dhi: 'でぃ',
    dei: 'でぃ',
    dwu: 'どぅ',
    tya: 'ちゃ',
    tyu: 'ちゅ',
    tyo: 'ちょ',
    cha: 'ちゃ',
    chu: 'ちゅ',
    che: 'ちぇ',
    cho: 'ちょ',
    ha: 'は',
    hi: 'ひ',
    fu: 'ふ',
    he: 'へ',
    ho: 'ほ',
    fa: 'ふぁ',
    fi: 'ふぃ',
    fe: 'ふぇ',
    fo: 'ふぉ',
    hya: 'ひゃ',
    hyu: 'ひゅ',
    hyo: 'ひょ',
    ba: 'ば',
    bi: 'び',
    bu: 'ぶ',
    be: 'べ',
    bo: 'ぼ',
    bya: 'びゃ',
    byu: 'びゅ',
    byo: 'びょ',
    pa: 'ぱ',
    pi: 'ぴ',
    pu: 'ぷ',
    pe: 'ぺ',
    po: 'ぽ',
    pya: 'ぴゃ',
    pyu: 'ぴゅ',
    pyo: 'ぴょ',
    ma: 'ま',
    mi: 'み',
    mu: 'む',
    me: 'め',
    mo: 'も',
    mya: 'みゃ',
    myu: 'みゅ',
    myo: 'みょ',
    ya: 'や',
    ye: 'いぇ',
    yu: 'ゆ',
    yo: 'よ',
    nya: 'にゃ',
    nyu: 'にゅ',
    nyo: 'にょ',
    rya: 'りゃ',
    ryu: 'りゅ',
    ryo: 'りょ',
    wa: 'わ',
    wi: 'うぃ',
    we: 'うぇ',
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
  const mapped = map[lyric]
  if (Array.isArray(mapped)) {
    return mapped
  }
  return mapped ? [mapped] : [lyric]
}

function hangulSyllableWithoutCoda(lyric: string) {
  const [first] = lyric.trim()
  if (!first) {
    return ''
  }
  const code = first.charCodeAt(0)
  const hangulBase = 0xac00
  const hangulEnd = 0xd7a3
  if (code < hangulBase || code > hangulEnd) {
    return ''
  }
  const offset = code - hangulBase
  const codaIndex = offset % 28
  if (codaIndex === 0) {
    return ''
  }
  return String.fromCharCode(code - codaIndex)
}

function hangulCodaTailAliases(lyric: string) {
  const [first] = lyric.trim()
  if (!first) {
    return []
  }
  const code = first.charCodeAt(0)
  const hangulBase = 0xac00
  const hangulEnd = 0xd7a3
  if (code < hangulBase || code > hangulEnd) {
    return []
  }
  const offset = code - hangulBase
  const vowelIndex = Math.floor((offset % (21 * 28)) / 28)
  const codaIndex = offset % 28
  if (codaIndex === 0) {
    return []
  }
  const vowel = HANGUL_VOWELS[vowelIndex]
  const coda = HANGUL_CODAS[codaIndex]
  if (!vowel || !coda) {
    return []
  }
  return [`${vowel}${coda}`, `-${vowel}${coda}`]
}

const HANGUL_VOWELS = [
  'ㅏ',
  'ㅐ',
  'ㅑ',
  'ㅒ',
  'ㅓ',
  'ㅔ',
  'ㅕ',
  'ㅖ',
  'ㅗ',
  'ㅘ',
  'ㅙ',
  'ㅚ',
  'ㅛ',
  'ㅜ',
  'ㅝ',
  'ㅞ',
  'ㅟ',
  'ㅠ',
  'ㅡ',
  'ㅢ',
  'ㅣ',
]

const HANGUL_CODAS = [
  '',
  'ㄱ',
  'ㄲ',
  'ㄳ',
  'ㄴ',
  'ㄵ',
  'ㄶ',
  'ㄷ',
  'ㄹ',
  'ㄺ',
  'ㄻ',
  'ㄼ',
  'ㄽ',
  'ㄾ',
  'ㄿ',
  'ㅀ',
  'ㅁ',
  'ㅂ',
  'ㅄ',
  'ㅅ',
  'ㅆ',
  'ㅇ',
  'ㅈ',
  'ㅊ',
  'ㅋ',
  'ㅌ',
  'ㅍ',
  'ㅎ',
]

function inferVoicebankName(fileName: string) {
  if (/teto/i.test(fileName)) {
    return 'Kasane Teto UTAU'
  }
  return fileName.replace(/\.[^.]+$/, '')
}
