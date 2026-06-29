import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { findBestEntryForLyric, findEntryForLyric, loadVoicebankZip } from './voicebank'

describe('voicebank zip loader', () => {
  it('extracts oto.ini aliases and wav paths', async () => {
    const zip = new JSZip()
    zip.file('Teto/character.yaml', 'name: Test Teto\n')
    zip.file('Teto/oto.ini', 'a.wav=あ,0,120,0,40,20\n')
    zip.file('Teto/a.wav', new Uint8Array([1, 2, 3, 4]))
    const blob = await zip.generateAsync({ type: 'blob' })
    const file = new File([blob], 'TETO-OUset240323.zip')

    const voicebank = await loadVoicebankZip(file)
    const entry = findEntryForLyric(voicebank, 'a')

    expect(voicebank.name).toBe('Test Teto')
    expect(voicebank.sampleCount).toBe(1)
    expect(voicebank.wavCount).toBe(1)
    expect(entry.alias).toBe('あ')
    expect(await voicebank.readSample(entry)).toBeInstanceOf(ArrayBuffer)
  })

  it('maps Korean guide lyrics to Japanese CV aliases', async () => {
    const zip = new JSZip()
    zip.file('Teto/character.yaml', 'name: Test Teto\n')
    zip.file(
      'Teto/oto.ini',
      [
        'do.wav=ど,0,120,0,40,20',
        'hi.wav=ひ,0,120,0,40,20',
        'da.wav=だ,0,120,0,40,20',
        'i.wav=い,0,120,0,40,20',
        'su.wav=す,0,120,0,40,20',
        'ki.wav=き,0,120,0,40,20',
      ].join('\n'),
    )
    for (const fileName of ['do.wav', 'hi.wav', 'da.wav', 'i.wav', 'su.wav', 'ki.wav']) {
      zip.file(`Teto/${fileName}`, new Uint8Array([1, 2, 3, 4]))
    }
    const blob = await zip.generateAsync({ type: 'blob' })
    const file = new File([blob], 'TETO-OUset240323.zip')

    const voicebank = await loadVoicebankZip(file)

    expect(findEntryForLyric(voicebank, '도').alias).toBe('ど')
    expect(findEntryForLyric(voicebank, '히').alias).toBe('ひ')
    expect(findEntryForLyric(voicebank, '다').alias).toBe('だ')
    expect(findEntryForLyric(voicebank, '이').alias).toBe('い')
    expect(findEntryForLyric(voicebank, '스').alias).toBe('す')
    expect(findEntryForLyric(voicebank, '키').alias).toBe('き')
  })

  it('prefers plain single-sound aliases over styled fallback aliases', async () => {
    const zip = new JSZip()
    zip.file('Teto/character.yaml', 'name: Test Teto\n')
    zip.file('Teto/重音テトささやき単独音/oto.ini', '_do.wav=ど囁,0,120,0,40,20\n')
    zip.file('Teto/重音テトささやき単独音/_do.wav', new Uint8Array([1, 2, 3, 4]))
    zip.file('Teto/重音テト単独音/oto.ini', '_do.wav=ど,0,120,0,40,20\n')
    zip.file('Teto/重音テト単独音/_do.wav', new Uint8Array([1, 2, 3, 4]))
    const blob = await zip.generateAsync({ type: 'blob' })
    const file = new File([blob], 'ranked.zip')

    const voicebank = await loadVoicebankZip(file)
    const entry = findBestEntryForLyric(voicebank, '도', 62)

    expect(entry.alias).toBe('ど')
    expect(entry.path).toContain('重音テト単独音')
  })

  it('chooses the closest pitched sample for the same alias', async () => {
    const zip = new JSZip()
    zip.file('Teto/character.yaml', 'name: Test Teto\n')
    zip.file('Teto/oto.ini', ['a_C4.wav=あ,0,120,0,40,20', 'a_G4.wav=あ,0,120,0,40,20'].join('\n'))
    zip.file('Teto/a_C4.wav', new Uint8Array([1, 2, 3, 4]))
    zip.file('Teto/a_G4.wav', new Uint8Array([1, 2, 3, 4]))
    const blob = await zip.generateAsync({ type: 'blob' })
    const file = new File([blob], 'multipitch.zip')

    const voicebank = await loadVoicebankZip(file)

    expect(findBestEntryForLyric(voicebank, 'a', 67).fileName).toBe('a_G4.wav')
    expect(findBestEntryForLyric(voicebank, 'a', 60).fileName).toBe('a_C4.wav')
  })
})
