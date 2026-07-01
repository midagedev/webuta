import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import {
  analyzeVoicebankCoverage,
  analyzeVoicebankRenderWarnings,
  findBestEntryForLyric,
  findCodaTailEntryForLyric,
  findEntryForLyric,
  findEntryMatchForLyric,
  findSustainEntryForLyric,
  loadVoicebankZip,
} from './voicebank'

describe('voicebank zip loader', () => {
  it('extracts oto.ini aliases and wav paths', async () => {
    const zip = new JSZip()
    zip.file('Teto/character.yaml', 'name: Test Teto\n')
    zip.file('Teto/readme.txt', 'Test Teto readme for WebUtau import.\n')
    zip.file('Teto/license.txt', 'Test Teto voicebank license terms.\n')
    zip.file('Teto/oto.ini', 'a.wav=あ,0,120,0,40,20\n')
    zip.file('Teto/a.wav', new Uint8Array([1, 2, 3, 4]))
    const blob = await zip.generateAsync({ type: 'blob' })
    const file = new File([blob], 'TETO-OUset240323.zip')

    const voicebank = await loadVoicebankZip(file)
    const entry = findEntryForLyric(voicebank, 'a')

    expect(voicebank.name).toBe('Test Teto')
    expect(voicebank.sampleCount).toBe(1)
    expect(voicebank.wavCount).toBe(1)
    expect(voicebank.metadata.characterPath).toBe('Teto/character.yaml')
    expect(voicebank.metadata.readme?.excerpt).toContain('Test Teto readme')
    expect(voicebank.metadata.license?.excerpt).toContain('Test Teto voicebank license')
    expect(voicebank.metadata.licenseStatus).toBe('license-file-present')
    expect(entry.alias).toBe('あ')
    expect(await voicebank.readSample(entry)).toBeInstanceOf(ArrayBuffer)
  })

  it('decodes legacy Shift-JIS oto.ini aliases from imported UTAU zips', async () => {
    const zip = new JSZip()
    zip.file('Legacy/character.yaml', 'name: Shift-JIS Singer\n')
    zip.file('Legacy/oto.ini', shiftJisBytesForAsciiAndA('a.wav=あ,0,120,0,40,20\r\n'))
    zip.file('Legacy/a.wav', new Uint8Array([1, 2, 3, 4]))
    const blob = await zip.generateAsync({ type: 'blob' })
    const file = new File([blob], 'shift-jis-oto.zip')

    const voicebank = await loadVoicebankZip(file)
    const entry = findEntryForLyric(voicebank, 'a')

    expect(voicebank.name).toBe('Shift-JIS Singer')
    expect(voicebank.aliases).toContain('あ')
    expect(entry.alias).toBe('あ')
    expect(entry.path).toBe('Legacy/a.wav')
  })

  it('extracts generated synthetic origin flags from a voicebank manifest', async () => {
    const zip = new JSZip()
    zip.file('WebUtau/character.yaml', 'name: WebUtau Korean V3 Synthetic\n')
    zip.file(
      'WebUtau/webuta-ko-v3.manifest.json',
      JSON.stringify({
        type: 'generated-synthetic-utau-cv-vc',
        sourceLineage: {
          method: 'deterministic-dsp-only',
          noHumanRecordingSource: true,
          noPublicOrPrivateRecordedDatasetSource: true,
          noThirdPartySingerOrCharacterSource: true,
          noTtsOrModelCheckpointOutput: true,
        },
        synthesis: {
          profile: 'deterministic-dsp-bright-formant-v3',
        },
      }),
    )
    zip.file('WebUtau/oto.ini', 'do_C4.wav=도,0,150,-560,70,30\n')
    zip.file('WebUtau/do_C4.wav', new Uint8Array([1, 2, 3, 4]))
    const blob = await zip.generateAsync({ type: 'blob' })
    const file = new File([blob], 'webuta-ko-v3.zip')

    const voicebank = await loadVoicebankZip(file)

    expect(voicebank.metadata.manifestPath).toBe('WebUtau/webuta-ko-v3.manifest.json')
    expect(voicebank.metadata.origin).toMatchObject({
      path: 'WebUtau/webuta-ko-v3.manifest.json',
      type: 'generated-synthetic-utau-cv-vc',
      method: 'deterministic-dsp-only',
      synthesisProfile: 'deterministic-dsp-bright-formant-v3',
      generatedSynthetic: true,
      noHumanRecordingSource: true,
      noPublicOrPrivateRecordedDatasetSource: true,
      noThirdPartySingerOrCharacterSource: true,
      noTtsOrModelCheckpointOutput: true,
    })
  })

  it('rejects voicebank zips above the browser-safe import size', async () => {
    const zip = new JSZip()
    zip.file('Teto/oto.ini', 'a.wav=あ,0,120,0,40,20\n')
    zip.file('Teto/a.wav', new Uint8Array([1, 2, 3, 4]))
    const blob = await zip.generateAsync({ type: 'blob' })
    const file = new File([blob], 'too-large.zip')

    await expect(loadVoicebankZip(file, { safetyLimits: { maxZipBytes: file.size - 1 } })).rejects.toThrow(
      /Voicebank zip is too large/,
    )
  })

  it('rejects unsafe paths inside voicebank zips', async () => {
    const zip = new JSZip()
    zip.file('Teto/oto.ini', '../evil.wav=あ,0,120,0,40,20\n')
    zip.file('Teto/../evil.wav', new Uint8Array([1, 2, 3, 4]))
    const blob = await zip.generateAsync({ type: 'blob' })
    const file = new File([blob], 'unsafe-path.zip')

    await expect(loadVoicebankZip(file)).rejects.toThrow(/unsafe path/)
  })

  it('rejects voicebank zips with too many WAV samples', async () => {
    const zip = new JSZip()
    zip.file('Teto/oto.ini', 'a.wav=あ,0,120,0,40,20\n')
    zip.file('Teto/a.wav', new Uint8Array([1, 2, 3, 4]))
    zip.file('Teto/i.wav', new Uint8Array([1, 2, 3, 4]))
    zip.file('Teto/u.wav', new Uint8Array([1, 2, 3, 4]))
    const blob = await zip.generateAsync({ type: 'blob' })
    const file = new File([blob], 'too-many-wavs.zip')

    await expect(loadVoicebankZip(file, { safetyLimits: { maxWavFiles: 2 } })).rejects.toThrow(/too many WAV/)
  })

  it('rejects oversized WAV members before sample playback', async () => {
    const zip = new JSZip()
    zip.file('Teto/oto.ini', 'big.wav=あ,0,120,0,40,20\n')
    zip.file('Teto/big.wav', new Uint8Array(16))
    const blob = await zip.generateAsync({ type: 'blob' })
    const file = new File([blob], 'oversized-sample.zip')

    await expect(loadVoicebankZip(file, { safetyLimits: { maxSingleWavBytes: 8 } })).rejects.toThrow(
      /WAV sample .* too large/,
    )
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
    expect(analyzeVoicebankCoverage(voicebank, [
      { lyric: '도' },
      { lyric: '히' },
      { lyric: '도' },
      { lyric: '히' },
      { lyric: '다' },
      { lyric: '이' },
      { lyric: '스' },
      { lyric: '키' },
    ])).toMatchObject({
      totalNotes: 8,
      matchedNotes: 8,
      fallbackNotes: 0,
      uniqueLyrics: 6,
      fallbackLyrics: [],
    })
  })

  it('maps common Japanese romaji yoon lyrics to hiragana or katakana aliases', async () => {
    const zip = new JSZip()
    zip.file('Teto/character.yaml', 'name: Test Teto\n')
    zip.file(
      'Teto/oto.ini',
      [
        'kya.wav=キャ,0,120,0,40,20',
        'shu.wav=しゅ,0,120,0,40,20',
        'ja.wav=じゃ,0,120,0,40,20',
        'cho.wav=チョ,0,120,0,40,20',
        'ryo.wav=りょ,0,120,0,40,20',
      ].join('\n'),
    )
    for (const fileName of ['kya.wav', 'shu.wav', 'ja.wav', 'cho.wav', 'ryo.wav']) {
      zip.file(`Teto/${fileName}`, new Uint8Array([1, 2, 3, 4]))
    }
    const blob = await zip.generateAsync({ type: 'blob' })
    const file = new File([blob], 'japanese-yoon.zip')

    const voicebank = await loadVoicebankZip(file)

    expect(findEntryForLyric(voicebank, 'kya').alias).toBe('キャ')
    expect(findEntryForLyric(voicebank, 'shu').alias).toBe('しゅ')
    expect(findEntryForLyric(voicebank, 'ja').alias).toBe('じゃ')
    expect(findEntryForLyric(voicebank, 'cho').alias).toBe('チョ')
    expect(findEntryForLyric(voicebank, 'ryo').alias).toBe('りょ')
    expect(analyzeVoicebankCoverage(voicebank, [
      { lyric: 'kya' },
      { lyric: 'shu' },
      { lyric: 'ja' },
      { lyric: 'cho' },
      { lyric: 'ryo' },
    ])).toMatchObject({
      totalNotes: 5,
      matchedNotes: 5,
      fallbackNotes: 0,
      fallbackLyrics: [],
    })
  })

  it('maps extended Japanese romaji CV lyrics used by UTAU banks', async () => {
    const zip = new JSZip()
    zip.file('Teto/character.yaml', 'name: Test Teto\n')
    zip.file(
      'Teto/oto.ini',
      [
        'fa.wav=ふぁ,0,120,0,40,20',
        'fi.wav=フィ,0,120,0,40,20',
        'she.wav=シェ,0,120,0,40,20',
        'je.wav=じぇ,0,120,0,40,20',
        'che.wav=チェ,0,120,0,40,20',
        'ti.wav=ティ,0,120,0,40,20',
        'tu.wav=トゥ,0,120,0,40,20',
        'tsa.wav=つぁ,0,120,0,40,20',
        'wi.wav=ウィ,0,120,0,40,20',
        'kwa.wav=くぁ,0,120,0,40,20',
        'gwa.wav=グァ,0,120,0,40,20',
      ].join('\n'),
    )
    for (const fileName of ['fa', 'fi', 'she', 'je', 'che', 'ti', 'tu', 'tsa', 'wi', 'kwa', 'gwa']) {
      zip.file(`Teto/${fileName}.wav`, new Uint8Array([1, 2, 3, 4]))
    }
    const blob = await zip.generateAsync({ type: 'blob' })
    const file = new File([blob], 'japanese-extended-cv.zip')

    const voicebank = await loadVoicebankZip(file)

    expect(findEntryForLyric(voicebank, 'fa').alias).toBe('ふぁ')
    expect(findEntryForLyric(voicebank, 'fi').alias).toBe('フィ')
    expect(findEntryForLyric(voicebank, 'she').alias).toBe('シェ')
    expect(findEntryForLyric(voicebank, 'je').alias).toBe('じぇ')
    expect(findEntryForLyric(voicebank, 'che').alias).toBe('チェ')
    expect(findEntryForLyric(voicebank, 'ti').alias).toBe('ティ')
    expect(findEntryForLyric(voicebank, 'tu').alias).toBe('トゥ')
    expect(findEntryForLyric(voicebank, 'tsa').alias).toBe('つぁ')
    expect(findEntryForLyric(voicebank, 'wi').alias).toBe('ウィ')
    expect(findEntryForLyric(voicebank, 'kwa').alias).toBe('くぁ')
    expect(findEntryForLyric(voicebank, 'gwa').alias).toBe('グァ')
    expect(analyzeVoicebankCoverage(voicebank, [
      { lyric: 'fa' },
      { lyric: 'fi' },
      { lyric: 'she' },
      { lyric: 'je' },
      { lyric: 'che' },
      { lyric: 'ti' },
      { lyric: 'tu' },
      { lyric: 'tsa' },
      { lyric: 'wi' },
      { lyric: 'kwa' },
      { lyric: 'gwa' },
    ])).toMatchObject({
      totalNotes: 11,
      matchedNotes: 11,
      fallbackNotes: 0,
      fallbackLyrics: [],
    })
  })

  it('uses Japanese VCV start and previous-vowel aliases from note context', async () => {
    const zip = new JSZip()
    zip.file('Teto/character.yaml', 'name: VCV Test Teto\n')
    zip.file(
      'Teto/oto.ini',
      [
        'start_do.wav=- ど,0,120,0,40,20',
        'o_hi.wav=o ひ,0,120,0,40,20',
        'i_do.wav=i ど,0,120,0,40,20',
        'o_hi_2.wav=o ひ,0,120,0,40,20',
      ].join('\n'),
    )
    for (const fileName of ['start_do.wav', 'o_hi.wav', 'i_do.wav', 'o_hi_2.wav']) {
      zip.file(`Teto/${fileName}`, new Uint8Array([1, 2, 3, 4]))
    }
    const blob = await zip.generateAsync({ type: 'blob' })
    const file = new File([blob], 'japanese-vcv.zip')

    const voicebank = await loadVoicebankZip(file)

    expect(findBestEntryForLyric(voicebank, '도', 60, { phraseStart: true }).alias).toBe('- ど')
    expect(findBestEntryForLyric(voicebank, '히', 62, { previousLyric: '도' }).alias).toBe('o ひ')
    expect(findBestEntryForLyric(voicebank, '도', 64, { previousLyric: '히' }).alias).toBe('i ど')
    expect(findBestEntryForLyric(voicebank, 'hi', 62, { previousLyric: 'do' }).alias).toBe('o ひ')
    expect(analyzeVoicebankCoverage(voicebank, [
      { lyric: '도', start: 0, duration: 480, trackId: 'main' },
      { lyric: '히', start: 480, duration: 480, trackId: 'main' },
      { lyric: '도', start: 960, duration: 480, trackId: 'main' },
      { lyric: '히', start: 1440, duration: 480, trackId: 'main' },
    ])).toMatchObject({
      totalNotes: 4,
      matchedNotes: 4,
      fallbackNotes: 0,
      uniqueLyrics: 2,
      fallbackLyrics: [],
    })
  })

  it('reports fallback coverage when a lyric has no alias match', async () => {
    const zip = new JSZip()
    zip.file('Teto/character.yaml', 'name: Test Teto\n')
    zip.file('Teto/oto.ini', 'a.wav=あ,0,120,0,40,20\n')
    zip.file('Teto/a.wav', new Uint8Array([1, 2, 3, 4]))
    const blob = await zip.generateAsync({ type: 'blob' })
    const file = new File([blob], 'partial.zip')

    const voicebank = await loadVoicebankZip(file)
    const match = findEntryMatchForLyric(voicebank, '키')
    const coverage = analyzeVoicebankCoverage(voicebank, [{ lyric: '아' }, { lyric: '키' }])

    expect(match.quality).toBe('fallback')
    expect(coverage).toMatchObject({
      totalNotes: 2,
      matchedNotes: 1,
      fallbackNotes: 1,
      fallbackLyrics: ['키'],
    })
    expect(analyzeVoicebankRenderWarnings(voicebank, [{ id: 'n1', lyric: '키', tone: 60 }])).toMatchObject({
      warningCount: 1,
      errorCount: 1,
      warnings: [expect.objectContaining({ kind: 'missing-alias', lyric: '키' })],
    })
  })

  it('approximates Hangul coda syllables with matching CV aliases', async () => {
    const zip = new JSZip()
    zip.file('WebUtau/character.yaml', 'name: WebUtau Korean Lite\n')
    zip.file('WebUtau/oto.ini', 'ha_C4.wav=하,0,150,-560,70,30\n')
    zip.file('WebUtau/ha_C4.wav', new Uint8Array([1, 2, 3, 4]))
    const blob = await zip.generateAsync({ type: 'blob' })
    const file = new File([blob], 'webuta-ko-lite.zip')

    const voicebank = await loadVoicebankZip(file)
    const match = findEntryMatchForLyric(voicebank, '한')
    const coverage = analyzeVoicebankCoverage(voicebank, [{ lyric: '한' }])

    expect(match.quality).not.toBe('fallback')
    expect(findEntryForLyric(voicebank, '한').alias).toBe('하')
    expect(coverage).toMatchObject({
      totalNotes: 1,
      matchedNotes: 1,
      fallbackNotes: 0,
    })
  })

  it('finds a VC coda tail alias for Hangul batchim lyrics', async () => {
    const zip = new JSZip()
    zip.file('WebUtau/character.yaml', 'name: WebUtau Korean V3 Synthetic\n')
    zip.file(
      'WebUtau/oto.ini',
      ['ga_C4.wav=가,0,150,-560,70,30', 'a_n_C4.wav=ㅏㄴ,0,90,-260,30,18'].join('\n'),
    )
    zip.file('WebUtau/ga_C4.wav', new Uint8Array([1, 2, 3, 4]))
    zip.file('WebUtau/a_n_C4.wav', new Uint8Array([1, 2, 3, 4]))
    const blob = await zip.generateAsync({ type: 'blob' })
    const file = new File([blob], 'webuta-ko-v3.zip')

    const voicebank = await loadVoicebankZip(file)

    expect(findEntryForLyric(voicebank, '간').alias).toBe('가')
    expect(findCodaTailEntryForLyric(voicebank, '간', 60)?.alias).toBe('ㅏㄴ')
    expect(findCodaTailEntryForLyric(voicebank, '가', 60)).toBeUndefined()
  })

  it('can choose a CV sustain entry for Hangul coda lyrics even when exact CVC exists', async () => {
    const zip = new JSZip()
    zip.file('WebUtau/character.yaml', 'name: WebUtau Korean V3 Synthetic\n')
    zip.file(
      'WebUtau/oto.ini',
      [
        'yeo_C4.wav=여,0,150,-560,70,30',
        'yeon_C4.wav=연,0,150,-560,70,30',
        'yeo_n_C4.wav=ㅕㄴ,0,90,-260,30,18',
      ].join('\n'),
    )
    zip.file('WebUtau/yeo_C4.wav', new Uint8Array([1, 2, 3, 4]))
    zip.file('WebUtau/yeon_C4.wav', new Uint8Array([1, 2, 3, 4]))
    zip.file('WebUtau/yeo_n_C4.wav', new Uint8Array([1, 2, 3, 4]))
    const blob = await zip.generateAsync({ type: 'blob' })
    const file = new File([blob], 'webuta-ko-v3.zip')

    const voicebank = await loadVoicebankZip(file)

    expect(findBestEntryForLyric(voicebank, '연', 60).alias).toBe('연')
    expect(findSustainEntryForLyric(voicebank, '연', 60)?.alias).toBe('여')
    expect(findCodaTailEntryForLyric(voicebank, '연', 60)?.alias).toBe('ㅕㄴ')
    expect(analyzeVoicebankRenderWarnings(voicebank, [{ id: 'n1', lyric: '연', tone: 60 }])).toMatchObject({
      warningCount: 0,
      errorCount: 0,
    })
  })

  it('warns when a note needs an extreme sample pitch shift', async () => {
    const zip = new JSZip()
    zip.file('WebUtau/character.yaml', 'name: WebUtau Korean V3 Synthetic\n')
    zip.file('WebUtau/oto.ini', 'a_C4.wav=아,0,150,-560,70,30\n')
    zip.file('WebUtau/a_C4.wav', new Uint8Array([1, 2, 3, 4]))
    const blob = await zip.generateAsync({ type: 'blob' })
    const file = new File([blob], 'webuta-ko-v3.zip')

    const voicebank = await loadVoicebankZip(file)
    const report = analyzeVoicebankRenderWarnings(voicebank, [{ id: 'high', lyric: '아', tone: 76 }])

    expect(report).toMatchObject({
      warningCount: 1,
      errorCount: 0,
      warnings: [expect.objectContaining({ kind: 'pitch-shift', noteId: 'high', semitoneShift: 16 })],
    })
  })

  it('warns when a Hangul coda lyric has no VC tail sample', async () => {
    const zip = new JSZip()
    zip.file('WebUtau/character.yaml', 'name: WebUtau Korean V3 Synthetic\n')
    zip.file('WebUtau/oto.ini', ['ga_C4.wav=가,0,150,-560,70,30', 'gan_C4.wav=간,0,150,-560,70,30'].join('\n'))
    zip.file('WebUtau/ga_C4.wav', new Uint8Array([1, 2, 3, 4]))
    zip.file('WebUtau/gan_C4.wav', new Uint8Array([1, 2, 3, 4]))
    const blob = await zip.generateAsync({ type: 'blob' })
    const file = new File([blob], 'webuta-ko-v3.zip')

    const voicebank = await loadVoicebankZip(file)
    const report = analyzeVoicebankRenderWarnings(voicebank, [{ id: 'coda', lyric: '간', tone: 60 }])

    expect(report).toMatchObject({
      warningCount: 1,
      errorCount: 0,
      warnings: [expect.objectContaining({ kind: 'missing-coda-tail', noteId: 'coda' })],
    })
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

  it('uses prefix.map suffixes to choose multipitch aliases without pitch-coded file names', async () => {
    const zip = new JSZip()
    zip.file('Singer/character.yaml', 'name: Prefix Map Singer\n')
    zip.file('Singer/prefix.map', ['C4\t\t_LOW', 'G4\t\t_HIGH'].join('\r\n'))
    zip.file(
      'Singer/oto.ini',
      ['soft.wav=あ_LOW,0,120,0,40,20', 'bright.wav=あ_HIGH,0,120,0,40,20'].join('\n'),
    )
    zip.file('Singer/soft.wav', new Uint8Array([1, 2, 3, 4]))
    zip.file('Singer/bright.wav', new Uint8Array([1, 2, 3, 4]))
    const blob = await zip.generateAsync({ type: 'blob' })
    const file = new File([blob], 'prefix-map.zip')

    const voicebank = await loadVoicebankZip(file)

    expect(voicebank.metadata.prefixMapPaths).toEqual(['Singer/prefix.map'])
    expect(voicebank.prefixMaps?.[0].rules).toHaveLength(2)
    expect(findBestEntryForLyric(voicebank, 'a', 60).fileName).toBe('soft.wav')
    expect(findBestEntryForLyric(voicebank, 'a', 67).fileName).toBe('bright.wav')
    expect(findEntryMatchForLyric(voicebank, 'a', 67)).toMatchObject({
      targetAlias: 'あ_high',
      quality: 'exact',
    })
  })
})

function shiftJisBytesForAsciiAndA(text: string) {
  const bytes: number[] = []
  for (const char of text) {
    if (char === 'あ') {
      bytes.push(0x82, 0xa0)
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
