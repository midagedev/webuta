export const sampleUstx = `
name: Sample USTX
comment: Imported from OpenUtau shape
ustx_version: 0.9
time_signatures:
  - bar_position: 0
    beat_per_bar: 4
    beat_unit: 4
tempos:
  - position: 0
    bpm: 128
tracks:
  - singer: demo
    phonemizer: default
    track_name: Lead
    track_color: Blue
voice_parts:
  - name: Verse
    track_no: 0
    position: 480
    duration: 1920
    notes:
      - position: 0
        duration: 480
        tone: 60
        lyric: la
      - position: 480
        duration: 480
        tone: 64
        lyric: li
    curves: []
wave_parts: []
`
