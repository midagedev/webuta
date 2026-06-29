import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearSavedVoicebankFile, loadSavedVoicebankFile, saveVoicebankFile } from './voicebankStorage'

describe('voicebank storage', () => {
  beforeEach(async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    await clearSavedVoicebankFile()
  })

  it('saves and restores the last imported voicebank zip', async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'TETO-OUset240323.zip', {
      type: 'application/zip',
      lastModified: 1234,
    })

    expect(await saveVoicebankFile(file)).toBe(true)
    const restored = await loadSavedVoicebankFile()
    const bytes = restored ? new Uint8Array(await restored.arrayBuffer()) : new Uint8Array()

    expect(restored?.name).toBe('TETO-OUset240323.zip')
    expect(restored?.type).toBe('application/zip')
    expect(restored?.lastModified).toBe(1234)
    expect([...bytes]).toEqual([1, 2, 3, 4])
  })

  it('clears the saved voicebank zip', async () => {
    const file = new File([new Uint8Array([1])], 'voice.zip')
    await saveVoicebankFile(file)

    expect(await clearSavedVoicebankFile()).toBe(true)
    expect(await loadSavedVoicebankFile()).toBeNull()
  })

  it('reports unavailable storage without throwing', async () => {
    vi.stubGlobal('indexedDB', undefined)
    const file = new File([new Uint8Array([1])], 'voice.zip')

    expect(await saveVoicebankFile(file)).toBe(false)
    expect(await loadSavedVoicebankFile()).toBeNull()
    expect(await clearSavedVoicebankFile()).toBe(false)
  })
})
