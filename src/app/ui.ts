import { isDawReadyWav, type WavInfo } from '../audio/wav'
import type { SongNote, SongProject } from '../types'
import type { LyricEntryMatch, VoicebankCoverage } from '../voicebank'

export const ROW_HEIGHT = 26
export const TICK_WIDTH = 0.15
export const MIN_NOTE_WIDTH = 44
export const NOTE_RESIZE_HANDLE_WIDTH = 14
export const LYRIC_PALETTE = ['도', '히', '다', '이', '스', '키', '라', '나']

export type VoicebankCacheStatus = 'idle' | 'bundled' | 'restoring' | 'restored' | 'saving' | 'saved' | 'session-only'

export function pitchRows(min: number, max: number) {
  const values: number[] = []
  for (let tone = max; tone >= min; tone--) {
    values.push(tone)
  }
  return values
}

export function isBlackKey(tone: number) {
  return [1, 3, 6, 8, 10].includes(((tone % 12) + 12) % 12)
}

export function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '0:00'
  }
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

export function formatWavSummary(info: WavInfo) {
  const sampleRateKhz = `${(info.sampleRate / 1000).toFixed(info.sampleRate % 1000 === 0 ? 0 : 1)} kHz`
  const channels = info.channelCount === 1 ? 'mono' : `${info.channelCount} ch`
  const readiness = isDawReadyWav(info) ? 'DAW-ready WAV' : 'WAV check'
  return `${readiness} · ${sampleRateKhz} ${info.formatName} ${channels}`
}

export function formatVoicebankCoverage(coverage: VoicebankCoverage | null, mode: 'full' | 'compact' = 'full') {
  if (!coverage || coverage.totalNotes === 0) {
    return mode === 'compact' ? '0/0' : '0/0 matched'
  }
  const ratio = `${coverage.matchedNotes}/${coverage.totalNotes}`
  return mode === 'compact' ? ratio : `${ratio} matched`
}

export function formatCoverageMessage(coverage: VoicebankCoverage) {
  if (coverage.fallbackNotes === 0) {
    return `현재 ${coverage.uniqueLyrics}개 고유 발음이 모두 보이스뱅크 alias에 연결됩니다.`
  }
  const missingLyrics = coverage.fallbackLyrics.slice(0, 6)
  return `미매칭 ${coverage.fallbackNotes}개: ${missingLyrics.join(', ')}${coverage.fallbackLyrics.length > missingLyrics.length ? '...' : ''}`
}

export function formatLyricMatch(match: LyricEntryMatch | null) {
  if (!match) {
    return 'alias 검사 대기'
  }
  if (match.quality === 'fallback') {
    return `${match.lyric} -> ${match.targetAlias || match.lyric} alias 없음`
  }
  const alias = match.candidates[0]?.alias ?? match.targetAlias
  return `${match.lyric} -> ${alias} (${match.quality})`
}

export function formatVoicebankCacheStatus(status: VoicebankCacheStatus) {
  switch (status) {
    case 'restoring':
      return '로컬 복원 중'
    case 'restored':
      return '이 기기에서 복원됨'
    case 'bundled':
      return '기본 번들'
    case 'saving':
      return '이 기기에 저장 중'
    case 'saved':
      return '이 기기 저장됨'
    case 'session-only':
      return '현재 세션 전용'
    case 'idle':
    default:
      return '로컬 ZIP 대기'
  }
}

export function formatLyricLine(notes: SongNote[]) {
  return [...notes]
    .sort((a, b) => a.start - b.start || a.tone - b.tone)
    .map((note) => note.lyric)
    .join(' ')
}

export function compactLyricLine(notes: SongNote[]) {
  return formatLyricLine(notes).replaceAll(' ', '')
}

export function reconcileSelectedNoteId(project: SongProject, selectedNoteId: string) {
  return project.notes.some((note) => note.id === selectedNoteId) ? selectedNoteId : project.notes[0]?.id ?? ''
}

export function inputValue(event: Event) {
  const target = event.currentTarget as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  return target.value
}

export function isTextEditingTarget(target: EventTarget | null) {
  const element = target instanceof HTMLElement ? target : null
  if (!element) {
    return false
  }
  return Boolean(element.closest('input, textarea, select, [contenteditable="true"]'))
}

export function isButtonLikeTarget(target: EventTarget | null) {
  const element = target instanceof HTMLElement ? target : null
  if (!element) {
    return false
  }
  return Boolean(element.closest('button, a'))
}
