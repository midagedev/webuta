import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { acceptWavDawHandoff } from './accept-wav-daw-handoff.mjs'

const tempRoots = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('accept WAV DAW handoff report', () => {
  it('copies a passing physical-device handoff into the release audit path', () => {
    const root = makeRoot()
    const source = join(root, 'downloads', 'handoff-report.local.json')
    const out = join(root, 'experiments', 'utau-v3', 'work', 'wav-daw-handoff', 'handoff-report.local.json')
    writeJson(source, makeHandoff())

    const report = acceptWavDawHandoff({ cwd: root, handoff: source, out })

    expect(report.ok).toBe(true)
    expect(report.decision).toBe('wav-daw-handoff-accepted')
    expect(JSON.parse(readFileSync(out, 'utf8')).environment.targetDaw).toBe('GarageBand iPad')
  })

  it('rejects incomplete device and DAW evidence without writing the accepted file', () => {
    const root = makeRoot()
    const source = join(root, 'downloads', 'handoff-report.local.json')
    const out = join(root, 'accepted', 'handoff-report.local.json')
    writeJson(
      source,
      makeHandoff({
        decision: 'needs-work',
        physicalDevice: false,
        checks: {
          targetDawImportWorked: false,
          targetDawPlaybackAudible: false,
        },
        handoff: {
          noConversionError: false,
        },
      }),
    )

    const report = acceptWavDawHandoff({ cwd: root, handoff: source, out })

    expect(report.ok).toBe(false)
    expect(report.problems.join('\n')).toContain('decision must be community-ready')
    expect(report.problems.join('\n')).toContain('must be verified on a physical device')
    expect(report.problems.join('\n')).toContain('check targetDawImportWorked must be true')
    expect(report.problems.join('\n')).toContain('noConversionError must be true')
    expect(existsSync(out)).toBe(false)
  })

  it('requires DAW-ready WAV metadata and the public Pages URL', () => {
    const root = makeRoot()
    const source = join(root, 'downloads', 'handoff-report.local.json')
    writeJson(
      source,
      makeHandoff({
        environment: {
          webutaUrl: 'http://localhost:5173/',
        },
        renderedWav: {
          sampleRate: 48000,
          channels: 2,
          bitsPerSample: 24,
          durationSeconds: 1,
          fileName: 'demo.aiff',
        },
      }),
    )

    const report = acceptWavDawHandoff({ cwd: root, handoff: source })

    expect(report.ok).toBe(false)
    expect(report.problems.join('\n')).toContain('webutaUrl must point to the public GitHub Pages app')
    expect(report.problems.join('\n')).toContain('renderedWav.sampleRate 48000 must be 44100')
    expect(report.problems.join('\n')).toContain('renderedWav.fileName must end with .wav')
  })
})

function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), 'webuta-daw-handoff-'))
  tempRoots.push(root)
  mkdirSync(join(root, 'downloads'), { recursive: true })
  return root
}

function writeJson(path, value) {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function makeHandoff(overrides = {}) {
  return deepMerge(
    {
      version: 1,
      reviewId: 'webuta-wav-daw-handoff-v1',
      reviewer: 'human reviewer',
      verifiedAt: '2026-07-01T00:00:00.000Z',
      decision: 'community-ready',
      physicalDevice: true,
      defaultVoicebank: 'WebUtau Korean V3 Synthetic',
      environment: {
        device: 'iPad',
        osVersion: 'iPadOS 26',
        browser: 'Safari',
        targetDaw: 'GarageBand iPad',
        webutaUrl: 'https://midagedev.github.io/webuta/',
      },
      checks: {
        openedFromPublicUrl: true,
        defaultVoicebankSelected: true,
        firstRunGuideVisible: true,
        starterLyricInputVisible: true,
        defaultLyricsMatched: true,
        audioPreviewWorked: true,
        wavExportWorked: true,
        targetDawImportWorked: true,
        targetDawPlaybackAudible: true,
        browserDraftRestored: true,
        noHorizontalOverflowPortrait: true,
        userVoicebankPrivacyConfirmed: true,
      },
      renderedWav: {
        fileName: 'First-Vocal-Sketch.wav',
        sampleRate: 44100,
        channels: 1,
        bitsPerSample: 16,
        durationSeconds: 6.55,
      },
      handoff: {
        exportMethod: 'share',
        importedRegionVisible: true,
        noConversionError: true,
        notes: '',
      },
      homeScreen: {
        status: 'pass',
        notes: '',
      },
      notes: '',
    },
    overrides,
  )
}

function deepMerge(base, override) {
  if (!override || typeof override !== 'object' || Array.isArray(override)) {
    return base
  }
  const result = { ...base }
  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && base[key] && typeof base[key] === 'object' && !Array.isArray(base[key])) {
      result[key] = deepMerge(base[key], value)
    } else {
      result[key] = value
    }
  }
  return result
}
