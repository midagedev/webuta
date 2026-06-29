import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { findEntryForLyric, loadVoicebankZip } from './voicebank'

const runTetoAsset = process.env.RUN_TETO_ASSET === '1'

describe.skipIf(!runTetoAsset)('official Kasane Teto OpenUTAU asset', () => {
  it('loads the local non-redistributed test zip and finds Japanese aliases', async () => {
    const bytes = await readFile('test-assets/TETO-OUset240323.zip')
    const file = new File([bytes], 'TETO-OUset240323.zip')

    const voicebank = await loadVoicebankZip(file)
    const a = findEntryForLyric(voicebank, 'a')
    const la = findEntryForLyric(voicebank, 'la')
    const doKorean = findEntryForLyric(voicebank, '도')
    const suKorean = findEntryForLyric(voicebank, '스')

    expect(voicebank.name).toContain('重音テト')
    expect(voicebank.sampleCount).toBeGreaterThan(1000)
    expect(voicebank.wavCount).toBeGreaterThan(1000)
    expect(a.alias).toContain('あ')
    expect(la.alias).toContain('ら')
    expect(doKorean.alias).toContain('ど')
    expect(suKorean.alias).toContain('す')
  }, 60000)
})
