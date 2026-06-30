import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { auditPrivateSingerPromptCoverage } from './audit-private-singer-prompt-coverage.mjs'
import { preparePrivateSingerRecordingPack } from './prepare-private-singer-recording-pack.mjs'

const tempRoots = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('private singer prompt coverage audit', () => {
  it('passes the default Korean private singer prompt book for first-session coverage', () => {
    const root = makeTempRoot()
    const packDir = join(root, 'pack')
    const reportPath = join(root, 'coverage.json')
    preparePrivateSingerRecordingPack({
      out: packDir,
      registryOut: join(root, 'registry.json'),
      targetMinutes: 35,
      sessionId: 'coverage-001',
    })

    const report = auditPrivateSingerPromptCoverage({
      packDir,
      report: reportPath,
    })

    expect(report.ok).toBe(true)
    expect(report.lyricCoverage.onset.missing).toEqual([])
    expect(report.lyricCoverage.vowel.missing).toEqual([])
    expect(report.lyricCoverage.coda.presentCount).toBeGreaterThanOrEqual(24)
    expect(report.totals.uniquePrompts).toBeGreaterThanOrEqual(20)
    expect(report.scoreCoverage.pitchRangeSemitones).toBeGreaterThanOrEqual(12)
    expect(JSON.parse(readFileSync(reportPath, 'utf8')).nextActions).toEqual([
      'Prompt coverage is ready for a first private recording session.',
    ])
  })

  it('fails with actionable gates for a tiny under-covered prompt book', () => {
    const root = makeTempRoot()
    const promptPath = join(root, 'tiny-prompts.json')
    const packDir = join(root, 'pack')
    writeFileSync(promptPath, JSON.stringify(makeTinyPromptBook(), null, 2))
    preparePrivateSingerRecordingPack({
      prompts: promptPath,
      out: packDir,
      registryOut: join(root, 'registry.json'),
      targetMinutes: 0.2,
      sessionId: 'tiny-001',
    })

    const report = auditPrivateSingerPromptCoverage({
      packDir,
      minTakes: 10,
      minMinutes: 1,
      minUniquePrompts: 2,
      minUniqueTags: 2,
      minKeys: 2,
      minUniqueSyllables: 10,
      minCodaCount: 5,
    })

    expect(report.ok).toBe(false)
    expect(report.gates.filter((gate) => !gate.passed).map((gate) => gate.id)).toEqual([
      'take-count',
      'duration',
      'prompt-count',
      'tag-count',
      'key-count',
      'syllable-count',
      'onset-coverage',
      'vowel-coverage',
      'coda-coverage',
      'pitch-range',
    ])
    expect(report.nextActions.join('\n')).toContain('Add Korean coverage prompts')
  })

  it('runs through the command-line entrypoint', () => {
    const root = makeTempRoot()
    const packDir = join(root, 'pack')
    preparePrivateSingerRecordingPack({
      out: packDir,
      registryOut: join(root, 'registry.json'),
      targetMinutes: 35,
      sessionId: 'cli-coverage-001',
    })

    const stdout = execFileSync(
      process.execPath,
      ['scripts/audit-private-singer-prompt-coverage.mjs', '--pack-dir', packDir],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    const report = JSON.parse(stdout)

    expect(report.ok).toBe(true)
    expect(report.lyricCoverage.vowel.presentCount).toBe(21)
  })
})

function makeTempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'webuta-prompt-coverage-'))
  tempRoots.push(root)
  return root
}

function makeTinyPromptBook() {
  return {
    version: 1,
    name: 'Tiny Prompt Book',
    language: 'ko',
    defaults: {
      tempo: 96,
      estimatedSeconds: 4,
      keys: ['C4'],
    },
    sets: [
      {
        id: 'tiny',
        name: 'Tiny',
        repeats: 1,
        prompts: [
          {
            id: 'la',
            lyric: '라라라',
            tags: ['tiny'],
            estimatedSeconds: 4,
          },
        ],
      },
    ],
  }
}
