import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte'
import { IDBFactory } from 'fake-indexeddb'
import JSZip from 'jszip'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.svelte'
import { demoProject } from './demoProject'
import { serializeWebutaProject } from './projectFile'
import { loadSavedProject, saveProject } from './projectStorage'
import { clearSavedVoicebankFile, saveVoicebankFile } from './voicebankStorage'

describe('App editing workflow', () => {
  beforeEach(async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    Object.defineProperty(URL, 'createObjectURL', {
      value: vi.fn(() => 'blob:webuta-test'),
      configurable: true,
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: vi.fn(),
      configurable: true,
    })
    Object.defineProperty(navigator, 'canShare', {
      value: undefined,
      configurable: true,
    })
    Object.defineProperty(navigator, 'share', {
      value: undefined,
      configurable: true,
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    localStorage.clear()
    await clearSavedVoicebankFile()
  })

  it('restores the last browser project draft', () => {
    saveProject({ ...demoProject, name: 'Recovered Draft' })

    render(App)

    expect((screen.getByLabelText('Project name') as HTMLInputElement).value).toBe('Recovered Draft')
    expect(screen.getByLabelText('Current project').textContent).toContain('Recovered Draft')
    expect(screen.getAllByText('Saved browser draft').length).toBeGreaterThan(0)
  })

  it('auto-saves project name edits', async () => {
    render(App)

    fireEvent.input(screen.getByLabelText('Project name'), { target: { value: 'Dohee Hook' } })

    await waitFor(() => {
      expect(loadSavedProject()?.name).toBe('Dohee Hook')
    })
  })

  it('starts a fresh vocal sketch from a restored draft', async () => {
    saveProject({
      ...demoProject,
      name: 'Old Draft',
      notes: demoProject.notes.map((note) => ({ ...note, lyric: 'la' })),
    })

    render(App)

    expect((screen.getByLabelText('Project name') as HTMLInputElement).value).toBe('Old Draft')

    fireEvent.click(screen.getByTitle('새 프로젝트'))

    await waitFor(() => {
      expect((screen.getByLabelText('Project name') as HTMLInputElement).value).toBe('Untitled Vocal Sketch')
      expect(loadSavedProject()?.notes.map((note) => note.lyric)).toEqual(['라', '라', '라', '라'])
    })
    expect(screen.getAllByText('New vocal sketch').length).toBeGreaterThan(0)
  })

  it('restores the built-in Hangul demo from the top bar', async () => {
    saveProject({
      ...demoProject,
      name: 'Old Draft',
      notes: demoProject.notes.map((note) => ({ ...note, lyric: 'la' })),
    })

    render(App)

    fireEvent.click(screen.getByTitle('데모로 리셋'))

    await waitFor(() => {
      expect((screen.getByLabelText('Project name') as HTMLInputElement).value).toBe('First Vocal Sketch')
      expect(loadSavedProject()?.notes.map((note) => note.lyric)).toEqual(['도', '히', '도', '히', '다', '이', '스', '키'])
    })
    expect(screen.getAllByText('Built-in Hangul demo').length).toBeGreaterThan(0)
  })

  it('surfaces a first-run guide with direct starter actions', async () => {
    render(App)

    const guide = screen.getByLabelText('First run guide')
    const path = within(guide).getByLabelText('Starter path')

    expect(within(guide).getByText('QUICK START')).toBeTruthy()
    expect(within(guide).getByText('First Vocal Sketch')).toBeTruthy()
    expect(within(guide).getByText('듣고, 가사를 바꾸고, WAV로 저장')).toBeTruthy()
    expect(within(guide).getByText('처음 1분')).toBeTruthy()
    expect(within(guide).getByText('샘플 듣기 / 가사·멜로디 / WAV 받기')).toBeTruthy()
    expect(within(guide).getByLabelText('Beginner mission')).toBeTruthy()
    expect(within(guide).getByLabelText('Beginner mission actions')).toBeTruthy()
    expect(within(guide).getByText('처음이면')).toBeTruthy()
    expect(within(guide).getByText('현재 가사')).toBeTruthy()
    expect(within(guide).getByText('기본 데모')).toBeTruthy()
    expect(within(guide).getAllByText('먼저 들어보기').length).toBeGreaterThan(0)
    expect(within(guide).getAllByText('도 히 도 히 다 이 스 키').length).toBeGreaterThan(0)
    expect(within(path).getByText('01')).toBeTruthy()
    expect(within(path).getByText('보이스 확인')).toBeTruthy()
    expect(within(path).getByText('02')).toBeTruthy()
    expect(within(path).getByText('먼저 들어보기')).toBeTruthy()
    expect(within(path).getByText('03')).toBeTruthy()
    expect(within(path).getByText('WAV 저장')).toBeTruthy()
    expect(screen.getAllByText('1').length).toBeGreaterThan(0)
    expect(screen.getAllByText('2').length).toBeGreaterThan(0)
    expect(screen.getAllByText('3').length).toBeGreaterThan(0)
    expect(screen.getAllByText('4').length).toBeGreaterThan(0)
    expect(within(guide).getAllByRole('button', { name: '스타터 재생' }).length).toBeGreaterThanOrEqual(1)
    expect(within(guide).getByRole('button', { name: '스타터 WAV 다운로드' })).toBeTruthy()
    expect(within(guide).getByRole('button', { name: '초보자 샘플 듣기' })).toBeTruthy()
    expect(within(guide).getByRole('button', { name: '초보자 가사 멜로디 열기' })).toBeTruthy()
    expect(within(guide).getByRole('button', { name: '초보자 WAV 받기' })).toBeTruthy()
    expect(within(guide).getByRole('button', { name: '새 프로젝트' })).toBeTruthy()
    expect(screen.getByLabelText('Vocal sketch cues').textContent).toContain('미리듣기')
    expect(screen.getByLabelText('Vocal sketch cues').textContent).toContain('가사·음정')
    expect(screen.getByLabelText('Vocal sketch cues').textContent).toContain('WAV 저장')
    expect(screen.getByLabelText('Tempo map').textContent).toContain('템포 맵')
    expect(screen.getByLabelText('Tempo map').textContent).toContain('1 marker')
    expect(screen.getByText('TEMPO')).toBeTruthy()
    expect(screen.getByText('1 MARK')).toBeTruthy()

    fireEvent.click(within(guide).getByRole('button', { name: '가사 라인 적용' }))

    await waitFor(() => {
      expect(screen.getAllByText('8 lyrics applied').length).toBeGreaterThan(0)
    })

    fireEvent.click(within(guide).getByRole('button', { name: '컴포즈 모드 열기' }))

    expect(screen.getByLabelText('Compose mode')).toBeTruthy()
  })

  it('adds a tempo marker at the selected note for DAW-style tempo maps', async () => {
    render(App)

    fireEvent.click(screen.getByRole('button', { name: '히 G4 note' }))
    fireEvent.input(screen.getByLabelText('New tempo marker BPM'), { target: { value: '132' } })
    fireEvent.click(screen.getByRole('button', { name: '선택 노트에 템포 마커 추가' }))

    await waitFor(() => {
      expect(loadSavedProject()?.tempoChanges).toContainEqual({ position: 480, bpm: 132 })
    })
    expect(screen.getByLabelText('Tempo map').textContent).toContain('2 markers')
    expect(screen.getByLabelText('Tempo map').textContent).toContain('1:2')
    expect(screen.getByText('2 MARK')).toBeTruthy()
  })

  it('duplicates the current project without overwriting the original draft name', async () => {
    saveProject({
      ...demoProject,
      name: 'Dohee Hook',
      notes: demoProject.notes.map((note, index) => ({ ...note, lyric: index === 0 ? '연' : note.lyric })),
    })

    render(App)

    fireEvent.click(screen.getByTitle('프로젝트 복제'))

    await waitFor(() => {
      expect((screen.getByLabelText('Project name') as HTMLInputElement).value).toBe('Dohee Hook Copy')
      expect(loadSavedProject()?.notes[0]?.lyric).toBe('연')
    })
    expect(screen.getAllByText('Duplicated from current project').length).toBeGreaterThan(0)
  })

  it('imports a saved WebUtau project file', async () => {
    const imported = {
      ...demoProject,
      name: 'Imported WebUtau Hook',
      notes: demoProject.notes.map((note, index) => ({ ...note, lyric: index === 0 ? '연' : note.lyric })),
    }
    const { container } = render(App)
    const projectInput = container.querySelector('input[accept*=".webutau.json"]') as HTMLInputElement

    fireEvent.change(projectInput, {
      target: {
        files: [
          new File([serializeWebutaProject(imported, '2026-06-30T00:00:00.000Z')], 'imported-hook.webutau.json', {
            type: 'application/json',
          }),
        ],
      },
    })

    await waitFor(() => {
      expect((screen.getByLabelText('Project name') as HTMLInputElement).value).toBe('Imported WebUtau Hook')
      expect(loadSavedProject()?.notes[0]?.lyric).toBe('연')
    })
    expect(screen.getAllByText('imported-hook.webutau.json').length).toBeGreaterThan(0)
  })

  it('imports a classic UST project file', async () => {
    const { container } = render(App)
    const projectInput = container.querySelector('input[accept*=".ust"]') as HTMLInputElement

    fireEvent.change(projectInput, {
      target: {
        files: [
          new File(
            [
              [
                '[#SETTING]',
                'Tempo=132',
                'ProjectName=Imported Classic UST',
                '[#0000]',
                'Length=240',
                'Lyric=R',
                'NoteNum=60',
                '[#0001]',
                'Length=480',
                'Lyric=도',
                'NoteNum=64',
                'Tempo=96',
                '[#TRACKEND]',
              ].join('\r\n'),
            ],
            'classic-hook.ust',
            { type: 'text/plain' },
          ),
        ],
      },
    })

    await waitFor(() => {
      expect((screen.getByLabelText('Project name') as HTMLInputElement).value).toBe('Imported Classic UST')
      expect(loadSavedProject()?.notes).toEqual([
        expect.objectContaining({ lyric: '도', tone: 64, start: 240, duration: 480 }),
      ])
      expect(loadSavedProject()?.tempoChanges).toEqual([
        { position: 0, bpm: 132 },
        { position: 240, bpm: 96 },
      ])
    })
    expect(screen.getAllByText('classic-hook.ust').length).toBeGreaterThan(0)
  })

  it('saves native WebUtau project JSON and keeps USTX/UST export available', async () => {
    render(App)

    fireEvent.click(screen.getByTitle('WebUtau 프로젝트 저장'))

    const createObjectURL = URL.createObjectURL as unknown as ReturnType<typeof vi.fn>
    const webutaBlob = createObjectURL.mock.calls.at(-1)?.[0] as Blob
    await expect(webutaBlob.text()).resolves.toContain('"format": "webuta-project"')
    expect(screen.getAllByText('WebUtau project saved').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByTitle('USTX 내보내기'))

    const ustxBlob = createObjectURL.mock.calls.at(-1)?.[0] as Blob
    await expect(ustxBlob.text()).resolves.toContain('ustx_version')
    expect(screen.getAllByText('USTX saved').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByTitle('UST 내보내기'))

    const ustBlob = createObjectURL.mock.calls.at(-1)?.[0] as Blob
    await expect(ustBlob.text()).resolves.toContain('[#SETTING]')
    await expect(ustBlob.text()).resolves.toContain('Lyric=도')
    expect(screen.getAllByText('UST saved').length).toBeGreaterThan(0)
  })

  it('restores the last imported voicebank zip', async () => {
    await saveVoicebankFile(await makeVoicebankZip())

    render(App)

    await waitForImportedTeto()
    expect(screen.getAllByText(/이 기기에서 복원됨/).length).toBeGreaterThan(0)
  })

  it('marks a newly imported voicebank zip as saved on this device', async () => {
    const { container } = render(App)
    const zipInput = container.querySelector('input[accept=".zip"]') as HTMLInputElement

    fireEvent.change(zipInput, { target: { files: [await makeMatchingVoicebankZip()] } })

    await waitForImportedTeto()
    await waitFor(() => {
      expect(screen.getAllByText(/이 기기 저장됨/).length).toBeGreaterThan(0)
    })
  })

  it('marks an imported voicebank as session-only when browser storage is unavailable', async () => {
    vi.stubGlobal('indexedDB', undefined)
    const { container } = render(App)
    const zipInput = container.querySelector('input[accept=".zip"]') as HTMLInputElement

    fireEvent.change(zipInput, { target: { files: [await makeMatchingVoicebankZip()] } })

    await waitForImportedTeto()
    await waitFor(() => {
      expect(screen.getAllByText(/현재 세션 전용/).length).toBeGreaterThan(0)
    })
  })

  it('opens license and credit boundaries from the toolbar', () => {
    render(App)

    fireEvent.click(screen.getByTitle('라이선스'))

    expect(screen.getByRole('dialog', { name: 'WebUtau Credits' })).toBeTruthy()
    expect(screen.getByText('Voicebanks are user-provided downloads. No Teto voicebank or singer artwork is bundled.')).toBeTruthy()
    expect(screen.getByText('The cyber vocal mascot is original project artwork, separate from singer characters.')).toBeTruthy()
    expect(screen.getByText('Runtime npm notices are generated in docs/THIRD_PARTY_NOTICES.md.')).toBeTruthy()

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(screen.queryByRole('dialog', { name: 'WebUtau Credits' })).toBeNull()
  })

  it('shows current lyric match coverage for an imported voicebank', async () => {
    await saveVoicebankFile(await makeMatchingVoicebankZip())

    render(App)

    await waitForImportedTeto()
    expect(screen.getAllByText(/8\/8 matched/).length).toBeGreaterThan(0)
    expect(screen.getByText('현재 6개 고유 발음이 모두 보이스뱅크 alias에 연결됩니다.')).toBeTruthy()
    expect(screen.getByText('도 -> ど (exact)')).toBeTruthy()
    expect(screen.getByText('렌더 경고 없음')).toBeTruthy()
    const licenseCard = screen.getByLabelText('Voicebank license metadata')
    expect(licenseCard.textContent).toContain('사용자 ZIP 라이선스 포함')
    expect(licenseCard.textContent).toContain('Test Teto matching license')
  })

  it('previews the selected note through the loaded UTAU sample renderer', async () => {
    await saveVoicebankFile(await makeMatchingVoicebankZip())
    const decodedSamples = new Float32Array(44100).fill(0.12)
    const decodedBuffer = {
      sampleRate: 44100,
      length: decodedSamples.length,
      numberOfChannels: 1,
      getChannelData: vi.fn(() => decodedSamples),
    }
    const decodeAudioData = vi.fn(async (_buffer: ArrayBuffer) => decodedBuffer)
    const renderedBuffer = {
      copyToChannel: vi.fn(),
    }
    const createBuffer = vi.fn((_channels: number, _length: number, _sampleRate: number) => renderedBuffer)
    const source = {
      buffer: null as AudioBuffer | null,
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      disconnect: vi.fn(),
      onended: null as (() => void) | null,
    }
    const gain = {
      gain: {
        setValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
      disconnect: vi.fn(),
    }
    class FakeAudioContext {
      state = 'running'
      currentTime = 0
      destination = {}

      decodeAudioData(buffer: ArrayBuffer) {
        return decodeAudioData(buffer)
      }

      createBuffer(channels: number, length: number, sampleRate: number) {
        return createBuffer(channels, length, sampleRate)
      }

      createBufferSource() {
        return source
      }

      createGain() {
        return gain
      }

      resume() {
        return Promise.resolve()
      }
    }
    Object.defineProperty(window, 'AudioContext', {
      value: FakeAudioContext,
      configurable: true,
    })

    render(App)

    await waitForImportedTeto()
    fireEvent.click(screen.getByRole('button', { name: '선택 노트 UTAU 샘플 미리듣기' }))

    await waitFor(() => {
      expect(decodeAudioData).toHaveBeenCalled()
      expect(source.start).toHaveBeenCalledOnce()
    })
    expect(createBuffer).toHaveBeenCalledWith(1, expect.any(Number), 44100)
    expect(renderedBuffer.copyToChannel).toHaveBeenCalledWith(expect.any(Float32Array), 0)
    expect(source.connect).toHaveBeenCalledWith(gain)
    expect(gain.connect).toHaveBeenCalled()
    expect(screen.getAllByText('UTAU sample 도 · E4').length).toBeGreaterThan(0)
  })

  it('shows fallback lyric coverage when the imported voicebank cannot match the demo line', async () => {
    await saveVoicebankFile(await makeVoicebankZip())

    render(App)

    await waitForImportedTeto()
    expect(screen.getByText('미매칭 8개: 도, 히, 다, 이, 스, 키')).toBeTruthy()
    expect(screen.getByText('도 -> ど alias 없음')).toBeTruthy()
    expect(screen.getByText('렌더 경고 8개')).toBeTruthy()
    expect(screen.getByText('8개 alias 오류 · 0개 주의')).toBeTruthy()
    expect(screen.getAllByText('도 alias 없음').length).toBeGreaterThan(0)
  })

  it('updates the selected lyric from the quick lyric pads', () => {
    render(App)

    const lyricPads = screen.getByLabelText('Quick lyric painter')
    fireEvent.click(within(lyricPads).getByRole('button', { name: '키' }))

    expect((screen.getByLabelText('가사') as HTMLInputElement).value).toBe('키')
  })

  it('plays a short preview from the touch performance keyboard', () => {
    const start = vi.fn()
    const stop = vi.fn()
    const oscillator = {
      type: 'sine',
      frequency: { setValueAtTime: vi.fn() },
      connect: vi.fn(),
      start,
      stop,
      disconnect: vi.fn(),
      onended: null as (() => void) | null,
    }
    const gain = {
      gain: {
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
      disconnect: vi.fn(),
    }
    class FakeAudioContext {
      state = 'running'
      currentTime = 0
      destination = {}

      createOscillator() {
        return oscillator
      }

      createGain() {
        return gain
      }

      resume() {
        return Promise.resolve()
      }
    }
    Object.defineProperty(window, 'AudioContext', {
      value: FakeAudioContext,
      configurable: true,
    })

    render(App)

    const keyboard = screen.getByLabelText('Touch performance keyboard')
    const previewButton = within(keyboard).getAllByRole('button')[1]
    fireEvent.pointerDown(previewButton, { pointerId: 1 })

    expect(start).toHaveBeenCalledOnce()
    expect(previewButton.className).toContain('pressed')
    const previewFrequency = oscillator.frequency.setValueAtTime.mock.calls[0][0]
    expect(previewFrequency).toBeCloseTo(392.0, 2)
    expect(oscillator.frequency.setValueAtTime).toHaveBeenCalledWith(previewFrequency, 0)
    expect(screen.getByText('히 · G4')).toBeTruthy()
    expect(screen.getAllByText('Preview 도 · G4').length).toBeGreaterThan(0)
  })

  it('records touch performance notes from the lyric queue as one undoable take', async () => {
    const now = vi.spyOn(performance, 'now')
    now.mockReturnValue(1000)
    render(App)

    fireEvent.input(screen.getByLabelText('가사 라인'), { target: { value: '가 나' } })
    fireEvent.click(screen.getByRole('button', { name: '녹음 시작' }))

    const keyboard = screen.getByLabelText('Touch performance keyboard')
    now.mockReturnValue(1250)
    fireEvent.pointerDown(within(keyboard).getAllByRole('button')[0], { pointerId: 1 })
    now.mockReturnValue(1500)
    fireEvent.pointerDown(within(keyboard).getAllByRole('button')[1], { pointerId: 2 })

    await waitFor(() => {
      const saved = loadSavedProject()
      expect(saved?.notes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ lyric: '가', tone: 64, start: 240, duration: 240 }),
          expect.objectContaining({ lyric: '나', tone: 67, start: 480, duration: 240 }),
        ]),
      )
    })

    fireEvent.click(screen.getByRole('button', { name: '녹음 정지' }))
    fireEvent.click(screen.getAllByRole('button', { name: '되돌리기' }).at(-1)!)

    await waitFor(() => {
      expect(loadSavedProject()?.notes).toHaveLength(8)
    })
    now.mockRestore()
  })

  it('undoes and redoes a lyric pad edit', async () => {
    render(App)

    const lyricPads = screen.getByLabelText('Quick lyric painter')
    fireEvent.click(within(lyricPads).getByRole('button', { name: '키' }))
    fireEvent.click(screen.getByTitle('되돌리기'))

    await waitFor(() => {
      expect(loadSavedProject()?.notes[0].lyric).toBe('도')
    })

    fireEvent.click(screen.getByTitle('다시 실행'))

    await waitFor(() => {
      expect(loadSavedProject()?.notes[0].lyric).toBe('키')
    })
  })

  it('applies a compact Korean lyric line across the melody', async () => {
    render(App)

    fireEvent.input(screen.getByLabelText('가사 라인'), { target: { value: '나나나나 라라라라' } })
    fireEvent.click(screen.getByRole('button', { name: '적용' }))

    await waitFor(() => {
      expect(loadSavedProject()?.notes.map((note) => note.lyric)).toEqual([
        '나',
        '나',
        '나',
        '나',
        '라',
        '라',
        '라',
        '라',
      ])
    })
  })

  it('applies spaced romanized lyrics across the melody', async () => {
    render(App)

    fireEvent.input(screen.getByLabelText('가사 라인'), { target: { value: 'do hi do hi da i su ki' } })
    fireEvent.click(screen.getByRole('button', { name: '적용' }))

    await waitFor(() => {
      expect(loadSavedProject()?.notes.map((note) => note.lyric)).toEqual([
        'do',
        'hi',
        'do',
        'hi',
        'da',
        'i',
        'su',
        'ki',
      ])
    })
  })

  it('generates and applies a melody from compose mode lyrics', async () => {
    render(App)

    fireEvent.click(screen.getByRole('button', { name: '작곡' }))

    fireEvent.input(screen.getByLabelText('Compose mode').querySelector('textarea') as HTMLTextAreaElement, {
      target: { value: '사랑해' },
    })
    fireEvent.change(screen.getByLabelText('Compose mode').querySelector('select') as HTMLSelectElement, {
      target: { value: 'minor' },
    })
    fireEvent.click(within(screen.getByLabelText('Compose mode')).getByRole('button', { name: '멜로디 적용' }))

    await waitFor(() => {
      const saved = loadSavedProject()
      expect(saved?.bpm).toBe(96)
      expect(saved?.notes.map((note) => note.lyric)).toEqual(['사', '랑', '해'])
      expect(saved?.parts[0].name).toBe('Generated Hook')
    })
    expect(screen.getAllByText(/Composer · Am/).length).toBeGreaterThan(0)
  })

  it('shares a rendered DAW-ready WAV when Web Share is available', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'canShare', {
      value: vi.fn(() => true),
      configurable: true,
    })
    Object.defineProperty(navigator, 'share', {
      value: share,
      configurable: true,
    })

    render(App)

    fireEvent.click(screen.getByRole('button', { name: '공유' }))

    await waitFor(() => {
      expect(share).toHaveBeenCalledOnce()
    })
    const payload = share.mock.calls[0][0]
    expect(payload.title).toBe('First Vocal Sketch')
    expect(payload.files[0]).toBeInstanceOf(File)
    expect(payload.files[0].type).toBe('audio/wav')
    await waitFor(() => {
      expect(screen.getAllByText('WAV shared').length).toBeGreaterThan(0)
    })
  })

  it('falls back to download when Web Share is unavailable', async () => {
    render(App)

    fireEvent.click(screen.getByRole('button', { name: '공유' }))

    await waitFor(() => {
      expect(screen.getAllByText('Share unavailable; WAV downloaded').length).toBeGreaterThan(0)
    })
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled()
  })

  it('exposes bottom dock export actions for touch layouts', () => {
    render(App)

    expect(screen.getByRole('button', { name: 'WAV 공유' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '하단 WAV 다운로드' })).toBeTruthy()
  })

  it('downloads a rendered WAV from the explicit download action', async () => {
    render(App)

    fireEvent.click(screen.getByTitle('WAV 다운로드'))

    await waitFor(() => {
      expect(screen.getAllByText('WAV downloaded').length).toBeGreaterThan(0)
    })
    expect(screen.getByText(/DAW-ready WAV · 44.1 kHz PCM mono/)).toBeTruthy()
  })

  it('adds a note by clicking an empty piano-roll cell', () => {
    const { container } = render(App)
    const grid = container.querySelector('.roll-grid') as HTMLDivElement
    grid.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 820,
        bottom: 520,
        width: 820,
        height: 520,
        toJSON: () => ({}),
      }) as DOMRect

    fireEvent.click(grid, { clientX: 167, clientY: 53 })

    expect(screen.getAllByText(/9 notes/).length).toBeGreaterThan(0)
  })

  it('duplicates the selected note as one undoable edit', async () => {
    render(App)

    fireEvent.click(screen.getByRole('button', { name: '선택 노트 복제' }))

    await waitFor(() => {
      const saved = loadSavedProject()
      expect(saved?.notes).toHaveLength(9)
      expect(saved?.notes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ lyric: '도', tone: 64, start: 420, duration: 420 }),
        ]),
      )
    })
    expect(screen.getAllByText('도 note duplicated').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByTitle('되돌리기'))

    await waitFor(() => {
      expect(loadSavedProject()?.notes).toHaveLength(8)
    })
  })

  it('nudges the selected note timing and pitch from the note panel', async () => {
    render(App)

    fireEvent.click(screen.getByTitle('뒤로 이동'))
    fireEvent.click(screen.getByTitle('음 높게'))

    await waitFor(() => {
      const savedNote = loadSavedProject()?.notes.find((note) => note.id === 'n1')
      expect(savedNote?.start).toBe(120)
      expect(savedNote?.tone).toBe(65)
    })
  })

  it('drags a piano-roll note to edit timing and pitch', async () => {
    const { container } = render(App)
    const noteBlock = container.querySelector('.note-block') as HTMLButtonElement
    noteBlock.getBoundingClientRect = makeRect({ left: 0, top: 0, width: 80, height: 24 })

    fireEvent.pointerDown(noteBlock, { pointerId: 1, clientX: 18, clientY: 18 })
    fireEvent.pointerMove(noteBlock, { pointerId: 1, clientX: 36, clientY: -8 })
    fireEvent.pointerUp(noteBlock, { pointerId: 1, clientX: 36, clientY: -8 })

    await waitFor(() => {
      const savedNote = loadSavedProject()?.notes.find((note) => note.id === 'n1')
      expect(savedNote?.start).toBe(120)
      expect(savedNote?.tone).toBe(65)
    })
  })

  it('undoes a drag edit as one operation', async () => {
    const { container } = render(App)
    const noteBlock = container.querySelector('.note-block') as HTMLButtonElement
    noteBlock.getBoundingClientRect = makeRect({ left: 0, top: 0, width: 80, height: 24 })

    fireEvent.pointerDown(noteBlock, { pointerId: 1, clientX: 18, clientY: 18 })
    fireEvent.pointerMove(noteBlock, { pointerId: 1, clientX: 36, clientY: 18 })
    fireEvent.pointerMove(noteBlock, { pointerId: 1, clientX: 54, clientY: 18 })
    fireEvent.pointerUp(noteBlock, { pointerId: 1, clientX: 54, clientY: 18 })

    await waitFor(() => {
      expect(loadSavedProject()?.notes.find((note) => note.id === 'n1')?.start).toBe(240)
    })

    fireEvent.click(screen.getByTitle('되돌리기'))

    await waitFor(() => {
      expect(loadSavedProject()?.notes.find((note) => note.id === 'n1')?.start).toBe(0)
    })
  })

  it('supports desktop undo and redo shortcuts outside text fields', async () => {
    render(App)

    const lyricPads = screen.getByLabelText('Quick lyric painter')
    fireEvent.click(within(lyricPads).getByRole('button', { name: '키' }))
    fireEvent.keyDown(window, { key: 'z', metaKey: true })

    await waitFor(() => {
      expect(loadSavedProject()?.notes[0].lyric).toBe('도')
    })

    fireEvent.keyDown(window, { key: 'z', metaKey: true, shiftKey: true })

    await waitFor(() => {
      expect(loadSavedProject()?.notes[0].lyric).toBe('키')
    })
  })

  it('resizes a piano-roll note from the right edge', async () => {
    const { container } = render(App)
    const noteBlock = container.querySelector('.note-block') as HTMLButtonElement
    noteBlock.getBoundingClientRect = makeRect({ left: 0, top: 0, width: 80, height: 24 })

    fireEvent.pointerDown(noteBlock, { pointerId: 1, clientX: 74, clientY: 18 })
    fireEvent.pointerMove(noteBlock, { pointerId: 1, clientX: 92, clientY: 18 })
    fireEvent.pointerUp(noteBlock, { pointerId: 1, clientX: 92, clientY: 18 })

    await waitFor(() => {
      const savedNote = loadSavedProject()?.notes.find((note) => note.id === 'n1')
      expect(savedNote?.duration).toBe(540)
    })
  })

  it('splits and deletes the selected note from the editor controls', async () => {
    render(App)

    fireEvent.click(screen.getByRole('button', { name: '선택 노트 분할' }))

    await waitFor(() => {
      const saved = loadSavedProject()
      expect(saved?.notes).toHaveLength(9)
      expect(saved?.notes.slice(0, 2)).toEqual([
        expect.objectContaining({ id: 'n1', lyric: '도', start: 0, duration: 240 }),
        expect.objectContaining({ lyric: '도', start: 240, duration: 180 }),
      ])
    })
    expect(screen.getAllByText('도 note split').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: '선택 노트 삭제' }))

    await waitFor(() => {
      expect(loadSavedProject()?.notes).toHaveLength(8)
    })
    expect(screen.getAllByText('도 note deleted').length).toBeGreaterThan(0)
  })

  it('sets a visible loop region around the selected note', () => {
    const { container } = render(App)

    fireEvent.click(screen.getByRole('button', { name: '선택 노트 루프' }))

    const loopRegion = container.querySelector('.loop-region') as HTMLDivElement
    expect(loopRegion).toBeTruthy()
    expect(loopRegion.getAttribute('style')).toContain('left: 0px')
    expect(loopRegion.getAttribute('style')).toContain('width: 72px')
    expect(screen.getAllByRole('button', { name: '루프 끄기' }).length).toBeGreaterThan(0)
  })

  it('renders piano key labels and bar labels inside the piano roll', () => {
    const { container } = render(App)

    expect(container.querySelectorAll('.keyboard .key-label').length).toBeGreaterThan(6)
    expect([...container.querySelectorAll('.roll-bar-label')].map((item) => item.textContent)).toEqual(
      expect.arrayContaining(['1', '2']),
    )
  })

  it('edits a focused note with arrow keys', async () => {
    const { container } = render(App)
    const noteBlock = container.querySelector('.note-block') as HTMLButtonElement

    fireEvent.keyDown(noteBlock, { key: 'ArrowRight' })
    fireEvent.keyDown(noteBlock, { key: 'ArrowUp' })

    await waitFor(() => {
      const savedNote = loadSavedProject()?.notes.find((note) => note.id === 'n1')
      expect(savedNote?.start).toBe(120)
      expect(savedNote?.tone).toBe(65)
    })
  })
})

async function makeVoicebankZip() {
  const zip = new JSZip()
  zip.file('Teto/character.yaml', 'name: Test Teto\n')
  zip.file('Teto/readme.txt', 'Test Teto readme for imported voicebank checks.\n')
  zip.file('Teto/license.txt', 'Test Teto license permits local WebUtau rendering.\n')
  zip.file('Teto/oto.ini', 'a.wav=あ,0,120,0,40,20\n')
  zip.file('Teto/a.wav', new Uint8Array([1, 2, 3, 4]))
  const blob = await zip.generateAsync({ type: 'blob' })
  return new File([blob], 'test-teto.zip', { type: 'application/zip' })
}

async function waitForImportedTeto() {
  await waitFor(() => {
    expect(screen.getAllByText(/Test Teto/u).length).toBeGreaterThan(0)
  }, { timeout: 5000 })
}

async function makeMatchingVoicebankZip() {
  const zip = new JSZip()
  zip.file('Teto/character.yaml', 'name: Test Teto\n')
  zip.file('Teto/readme.txt', 'Test Teto matching readme for imported voicebank checks.\n')
  zip.file('Teto/license.txt', 'Test Teto matching license permits local WebUtau rendering.\n')
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
  return new File([blob], 'matching-teto.zip', { type: 'application/zip' })
}

function makeRect(input: { left: number; top: number; width: number; height: number }) {
  const { left, top, width, height } = input
  return () =>
    ({
      x: left,
      y: top,
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
      toJSON: () => ({}),
    }) as DOMRect
}
