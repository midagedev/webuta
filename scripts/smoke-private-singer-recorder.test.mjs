import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { smokePrivateSingerRecorder } from './smoke-private-singer-recorder.mjs'

const tempRoots = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('private singer recorder browser smoke', () => {
  it('opens the recorder UI and saves a synthetic WAV through the browser upload path', async () => {
    const root = makeTempRoot()
    const reportPath = join(root, 'recorder-smoke.json')

    const report = await smokePrivateSingerRecorder({ out: reportPath })

    expect(report).toMatchObject({
      ok: true,
      mode: 'temp-pack',
      session: {
        guideCount: 1,
        recordedCount: 1,
      },
      firstTake: {
        lyric: '도히도히 다이스키',
        guideExists: true,
        recordedExists: true,
      },
      syntheticUpload: {
        sampleRate: 16000,
        channels: 1,
        bitsPerSample: 16,
      },
    })
    expect(report.page.desktop.horizontalOverflow).toBe(false)
    expect(report.page.mobile.horizontalOverflow).toBe(false)
    expect(JSON.parse(readFileSync(reportPath, 'utf8')).checks).toContain('browser synthetic WAV upload saved')
  }, 60_000)

  it('prints help from the command-line entrypoint', () => {
    const stdout = execFileSync(process.execPath, ['scripts/smoke-private-singer-recorder.mjs', '--help'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    })

    expect(stdout).toContain('Usage: node scripts/smoke-private-singer-recorder.mjs')
    expect(stdout).toContain('--pack-dir')
    expect(stdout).toContain('--write-synthetic')
  })
})

function makeTempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'webuta-recorder-smoke-test-'))
  tempRoots.push(root)
  return root
}
