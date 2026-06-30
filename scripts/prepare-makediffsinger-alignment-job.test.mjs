import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareMakeDiffSingerAlignmentJob } from './prepare-makediffsinger-alignment-job.mjs'

const tempRoots = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('MakeDiffSinger alignment job preparation', () => {
  it('writes reproducible MFA and MakeDiffSinger command scripts', () => {
    const fixture = makeFixture()

    const result = prepareMakeDiffSingerAlignmentJob({
      seedDir: fixture.seedDir,
      dictionary: fixture.dictionary,
      out: fixture.outDir,
      makeDiffSingerRoot: fixture.makeDiffSingerRoot,
      python: '/opt/mfa/bin/python',
      mfaCommand: '/opt/mfa/bin/mfa',
      mfaModel: fixture.mfaModel,
      beam: 123,
      production: true,
      normalize: true,
      skipSilenceInsertion: true,
    })

    const manifest = JSON.parse(readFileSync(result.manifest, 'utf8'))
    expect(manifest).toMatchObject({
      source: 'webuta-makediffsinger-alignment-job',
      production: true,
      labelCount: 1,
      wavCount: 1,
      mfaModelExists: true,
      beam: 123,
    })
    expect(readFileSync(result.scripts['01-reformat-wavs.sh'], 'utf8')).toContain('--normalize')
    expect(readFileSync(result.scripts['02-run-mfa-align.sh'], 'utf8')).toContain('--beam 123')
    expect(readFileSync(result.scripts['05-build-dataset.sh'], 'utf8')).toContain('--skip_silence_insertion')
    expect(readFileSync(result.scripts['06-audit-enhanced-dataset.sh'], 'utf8')).toContain('--production')
    expect(statSync(result.scripts['run-all.sh']).mode & 0o111).toBeGreaterThan(0)
  })

  it('allows a missing MFA acoustic model but records the warning', () => {
    const fixture = makeFixture()

    const result = prepareMakeDiffSingerAlignmentJob({
      seedDir: fixture.seedDir,
      dictionary: fixture.dictionary,
      out: fixture.outDir,
      makeDiffSingerRoot: fixture.makeDiffSingerRoot,
    })

    expect(result.warnings.join('\n')).toContain('WEBUTA_MFA_MODEL')
    expect(JSON.parse(readFileSync(result.manifest, 'utf8')).mfaModelExists).toBe(false)
  })

  it('runs from the command line', () => {
    const fixture = makeFixture()
    const out = join(fixture.root, 'cli-job')

    const stdout = execFileSync(
      process.execPath,
      [
        'scripts/prepare-makediffsinger-alignment-job.mjs',
        '--seed-dir',
        fixture.seedDir,
        '--dictionary',
        fixture.dictionary,
        '--out',
        out,
        '--make-diffsinger-root',
        fixture.makeDiffSingerRoot,
        '--mfa-model',
        fixture.mfaModel,
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    const result = JSON.parse(stdout)

    expect(existsSync(result.manifest)).toBe(true)
    expect(existsSync(join(out, 'scripts', '02-run-mfa-align.sh'))).toBe(true)
  })
})

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'webuta-makediffsinger-alignment-'))
  tempRoots.push(root)
  const seedDir = join(root, 'openvpi-seed')
  const labelDir = join(seedDir, 'raw', 'wavs')
  const dictionary = join(root, 'korean.dict')
  const mfaModel = join(root, 'korean-acoustic-model.zip')
  const outDir = join(root, 'alignment-job')
  const makeDiffSingerRoot = join(root, 'MakeDiffSinger')
  const toolDir = join(makeDiffSingerRoot, 'acoustic_forced_alignment')
  mkdirSync(labelDir, { recursive: true })
  mkdirSync(toolDir, { recursive: true })
  writeFileSync(join(labelDir, 'song-001.wav'), 'fixture wav')
  writeFileSync(join(labelDir, 'song-001.lab'), '도 히\n')
  writeFileSync(dictionary, '도\td o\n히\th i\n')
  writeFileSync(mfaModel, 'fixture model')
  for (const script of ['validate_labels.py', 'reformat_wavs.py', 'check_tg.py', 'enhance_tg.py', 'build_dataset.py']) {
    writeFileSync(join(toolDir, script), '# fixture\n')
  }
  return { root, seedDir, dictionary, mfaModel, outDir, makeDiffSingerRoot }
}
