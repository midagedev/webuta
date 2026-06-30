import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { OPENSLR_KOREAN_PRESETS, downloadOpenSlrKoreanSpeech } from './download-openslr-korean-speech.mjs'

describe('OpenSLR Korean speech downloader', () => {
  const roots = []

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('downloads preset archives and writes speech-only registry evidence', async () => {
    const root = mkdtempSync(join(tmpdir(), 'webuta-openslr-download-'))
    roots.push(root)
    const server = await fixtureServer()

    try {
      const outDir = join(root, 'openslr')
      const manifest = await downloadOpenSlrKoreanSpeech({
        preset: 'fixture-korean',
        outDir,
        presets: {
          'fixture-korean': {
            id: 'fixture-korean-speech-aux',
            name: 'Fixture Korean speech corpus',
            sourceUrl: 'http://example.test/fixture',
            outDirName: 'fixture-korean',
            licenseStatus: 'cc-by-4.0-speech-auxiliary',
            redistribution: 'original-license-cc-by-4.0',
            modelPublishing: 'not-singing-data-release-review-required',
            licenseLabel: 'CC BY 4.0',
            audioHours: 1,
            annotationTypes: ['tar.gz', 'audio', 'transcript'],
            allowedActions: {
              localTraining: false,
              publicModelRelease: false,
              publicAudioExamples: false,
            },
            reviewNotes: ['Speech fixture only.'],
            files: [
              {
                name: 'fixture.tar.gz',
                url: `http://127.0.0.1:${server.port}/fixture.tar.gz`,
                description: 'Fixture archive',
              },
            ],
          },
        },
      })

      expect(manifest.metrics).toMatchObject({
        fileCount: 1,
        presentFileCount: 1,
        totalExpectedBytes: Buffer.byteLength('fixture-archive'),
        totalPresentBytes: Buffer.byteLength('fixture-archive'),
      })
      expect(manifest.files[0].sha256).toBe(sha256('fixture-archive'))

      const registry = JSON.parse(readFileSync(join(outDir, 'dataset-registry.local.json'), 'utf8'))
      expect(registry.datasets[0]).toMatchObject({
        id: 'fixture-korean-speech-aux',
        licenseStatus: 'cc-by-4.0-speech-auxiliary',
        allowedActions: {
          localTraining: false,
        },
      })
    } finally {
      await server.close()
    }
  })

  it('tracks the Deeply parent-child vocal corpus as singing-labeled reference-only data', () => {
    expect(OPENSLR_KOREAN_PRESETS['deeply-parent-child-vocal']).toMatchObject({
      id: 'deeply-parent-child-vocal-reference-only',
      licenseStatus: 'cc-by-nc-nd-4.0-reference-only',
      annotationTypes: expect.arrayContaining(['singing-labels']),
      allowedActions: {
        localTraining: false,
        publicModelRelease: false,
        publicAudioExamples: false,
      },
    })
    expect(OPENSLR_KOREAN_PRESETS['deeply-parent-child-vocal'].reviewNotes.join(' ')).toContain('NoDerivatives')
  })
})

async function fixtureServer() {
  const body = 'fixture-archive'
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1')
    if (url.pathname === '/fixture.tar.gz') {
      response.writeHead(200, {
        'content-type': 'application/gzip',
        'content-length': Buffer.byteLength(body),
      })
      if (request.method === 'HEAD') {
        response.end()
      } else {
        response.end(body)
      }
      return
    }
    response.writeHead(404)
    response.end('missing')
  })

  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', resolve)
    server.once('error', reject)
  })
  return {
    port: server.address().port,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}
