import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import {
  analyzeVoicebankCoverage,
  findBestEntryForLyric,
  findCodaTailEntryForLyric,
  findSustainEntryForLyric,
  loadVoicebankZip,
} from './voicebank'
import { demoSamples } from './demoProject'

const generatedV3Path = join(process.cwd(), 'public', 'voicebanks', 'webuta-ko-v3.zip')

describe.skipIf(!existsSync(generatedV3Path))('generated WebUtau Korean V3 voicebank', () => {
  it('loads as a UTAU zip and covers the first-run demo phrase', async () => {
    const bytes = readFileSync(generatedV3Path)
    const zip = await JSZip.loadAsync(bytes)
    const manifest = JSON.parse(await zip.file('webuta-ko-v3.manifest.json')?.async('string') ?? '{}')
    const file = new File([bytes], 'webuta-ko-v3.zip', { type: 'application/zip' })
    const voicebank = await loadVoicebankZip(file)
    const demoNotes = ['네', '오', '빛', '이', '메', '로', '디', '로', '데', '려', '가'].map((lyric) => ({ lyric }))
    const coverage = analyzeVoicebankCoverage(voicebank, demoNotes)

    expect(voicebank.name).toBe('WebUtau Korean V3 Synthetic')
    expect(bytes.byteLength).toBeLessThan(50_000_000)
    expect(manifest.sampleRate).toBe(40000)
    expect(voicebank.wavCount).toBe(685)
    expect(voicebank.sampleCount).toBe(1603)
    expect(coverage).toMatchObject({
      totalNotes: 11,
      matchedNotes: 11,
      fallbackNotes: 0,
    })
    expect(findBestEntryForLyric(voicebank, '도', 60).fileName).toContain('C4')
    expect(findBestEntryForLyric(voicebank, '도', 65).fileName).toContain('F4')
    expect(findBestEntryForLyric(voicebank, '도', 69).fileName).toContain('A4')
    expect(findBestEntryForLyric(voicebank, '키', 69).fileName).toContain('A4')
    expect(findBestEntryForLyric(voicebank, '연', 60).alias).toBe('연')
    expect(findSustainEntryForLyric(voicebank, '연', 60)?.alias).toBe('여')
    expect(findCodaTailEntryForLyric(voicebank, '연', 60)?.alias).toBe('ㅕㄴ')
    expect(findBestEntryForLyric(voicebank, '빛', 72).alias).toBe('빛')
    expect(findSustainEntryForLyric(voicebank, '빛', 72)?.alias).toBe('비')
    expect(findCodaTailEntryForLyric(voicebank, '빛', 72)?.alias).toBe('ㅣㅊ')
  })

  it('covers every bundled starter sample lyric with V3 aliases', async () => {
    const bytes = readFileSync(generatedV3Path)
    const file = new File([bytes], 'webuta-ko-v3.zip', { type: 'application/zip' })
    const voicebank = await loadVoicebankZip(file)

    for (const sample of demoSamples) {
      const coverage = analyzeVoicebankCoverage(voicebank, sample.project.notes)
      expect(coverage, `${sample.title} should not fall back to browser beeps`).toMatchObject({
        totalNotes: sample.project.notes.length,
        matchedNotes: sample.project.notes.length,
        fallbackNotes: 0,
      })
    }
  })
})
