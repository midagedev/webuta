import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  analyzeVoicebankCoverage,
  findBestEntryForLyric,
  findCodaTailEntryForLyric,
  findSustainEntryForLyric,
  loadVoicebankZip,
} from './voicebank'

const generatedV3Path = join(process.cwd(), 'public', 'voicebanks', 'webuta-ko-v3.zip')

describe.skipIf(!existsSync(generatedV3Path))('generated WebUtau Korean V3 voicebank', () => {
  it('loads as a UTAU zip and covers the first-run demo phrase', async () => {
    const bytes = readFileSync(generatedV3Path)
    const file = new File([bytes], 'webuta-ko-v3.zip', { type: 'application/zip' })
    const voicebank = await loadVoicebankZip(file)
    const demoNotes = ['도', '히', '도', '히', '다', '이', '스', '키'].map((lyric) => ({ lyric }))
    const coverage = analyzeVoicebankCoverage(voicebank, demoNotes)

    expect(voicebank.name).toBe('WebUtau Korean V3 Synthetic')
    expect(voicebank.wavCount).toBe(615)
    expect(voicebank.sampleCount).toBe(1437)
    expect(coverage).toMatchObject({
      totalNotes: 8,
      matchedNotes: 8,
      fallbackNotes: 0,
    })
    expect(findBestEntryForLyric(voicebank, '도', 60).fileName).toContain('C4')
    expect(findBestEntryForLyric(voicebank, '도', 65).fileName).toContain('F4')
    expect(findBestEntryForLyric(voicebank, '도', 69).fileName).toContain('A4')
    expect(findBestEntryForLyric(voicebank, '키', 69).fileName).toContain('A4')
    expect(findBestEntryForLyric(voicebank, '연', 60).alias).toBe('연')
    expect(findSustainEntryForLyric(voicebank, '연', 60)?.alias).toBe('여')
    expect(findCodaTailEntryForLyric(voicebank, '연', 60)?.alias).toBe('ㅕㄴ')
  })
})
