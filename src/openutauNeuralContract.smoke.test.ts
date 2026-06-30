import { describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
// @ts-expect-error The DiffSinger adapter is a Node-side .mjs script covered by its own tests.
import { neuralRequestToDiffSingerDs } from '../scripts/diffsinger-ds-adapter.mjs'
import { createNeuralRenderRequest } from './neuralRender'
import { parseUstx, serializeUstx } from './ustx'

const koreanOpenUtauFixture = `
name: Korean OpenUtau Neural Fixture
comment: Verifies USTX import can feed the neural render contract.
ustx_version: 0.9
time_signatures:
  - bar_position: 0
    beat_per_bar: 4
    beat_unit: 4
tempos:
  - position: 0
    bpm: 120
tracks:
  - singer: webuta-ko-v3-synthetic
    phonemizer: Korean CVVC
    track_name: Lead Korean
    track_color: Blue
voice_parts:
  - name: Verse
    track_no: 0
    position: 0
    duration: 2400
    notes:
      - position: 0
        duration: 480
        tone: 60
        lyric: 강
      - position: 720
        duration: 240
        tone: 60
        lyric: 쉼
      - position: 960
        duration: 480
        tone: 62
        lyric: 밤
      - position: 1440
        duration: 480
        tone: 62
        lyric: '-'
      - position: 1920
        duration: 240
        tone: 60
        lyric: 숨
    curves: []
wave_parts: []
`

describe('OpenUtau to neural render contract smoke', () => {
  it('preserves Korean notes, rests, ties, breath, and coda phones through the DiffSinger adapter', () => {
    const imported = parseUstx(koreanOpenUtauFixture, 'korean-openutau-fixture.ustx')
    const roundTrip = parseUstx(serializeUstx(imported), 'round-trip.ustx')
    const request = createNeuralRenderRequest(roundTrip, {
      includeRests: true,
      voiceId: 'webuta-ko-neural-dev',
      renderer: 'diffsinger',
    })
    const ds = neuralRequestToDiffSingerDs(request)
    const segment = ds.segments[0]

    expect(roundTrip.source?.format).toBe('ustx-yaml')
    expect(roundTrip.notes.map((note) => note.lyric)).toEqual(['강', '쉼', '밤', '-', '숨'])
    expect(request.notes.map((note) => note.kind)).toEqual(['note', 'rest', 'rest', 'note', 'tie', 'breath'])
    expect(request.notes[0].phonemes.at(-1)).toMatchObject({ symbol: 'ng', role: 'coda', source: '강' })
    expect(request.notes[3].phonemes.at(-1)).toMatchObject({ symbol: 'm', role: 'coda', source: '밤' })
    expect(request.notes[4]).toMatchObject({ kind: 'tie', lyric: '-', midi: 62 })
    expect(request.notes[5]).toMatchObject({ kind: 'breath', lyric: '숨', midi: null, targetHz: null })

    expect(segment.text).toBe('강 SP SP 밤 - SP')
    expect(segment.ph_seq).toContain('k ɐ ŋ')
    expect(segment.ph_seq).toContain('p ɐ m')
    expect(segment.ph_seq.split(' ')).toContain('AP')
    expect(segment.note_seq.split(' ')).toEqual(['C4', 'rest', 'rest', 'D4', 'D4', 'rest'])
    expect(segment.note_slur.split(' ').map(Number)).toEqual([0, 0, 0, 0, 1, 0])
    expect(ds.diagnostics).toMatchObject({
      renderer: 'diffsinger',
      modelId: 'webuta-ko-neural-dev',
      noteCount: 6,
      eventCount: 6,
    })
    expect(ds.diagnostics.warnings.join('\n')).toContain('Tie note')
    expect(ds.diagnostics.warnings.join('\n')).toContain('Breath note')

    writeContractSmokeReport({
      version: 1,
      generatedAt: new Date().toISOString(),
      ok: true,
      mode: 'openutau-neural-contract',
      sourceFixture: 'korean-openutau-fixture.ustx',
      checks: [
        'UTAU/OpenUtau import compatibility',
        'USTX round trip preserves Korean lyrics',
        'neural render request preserves notes, rests, ties, and breath events',
        'Hangul coda phones survive DiffSinger DS adapter conversion',
      ],
      evidence: {
        importedFormat: roundTrip.source?.format,
        visibleLyrics: roundTrip.notes.map((note) => note.lyric),
        neuralKinds: request.notes.map((note) => note.kind),
        dsText: segment.text,
        dsPhonemeSequence: segment.ph_seq,
        dsNoteSequence: segment.note_seq,
        dsNoteSlur: segment.note_slur,
        warnings: ds.diagnostics.warnings,
      },
    })
  })
})

function writeContractSmokeReport(report: unknown) {
  const reportPath = process.env.WEBUTA_CONTRACT_SMOKE_REPORT
  if (!reportPath) {
    return
  }
  const resolved = resolve(reportPath)
  mkdirSync(dirname(resolved), { recursive: true })
  writeFileSync(resolved, `${JSON.stringify(report, null, 2)}\n`)
}
