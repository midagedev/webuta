import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { downloadCsd } from './download-csd.mjs'

describe('CSD downloader', () => {
  const roots = []

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('downloads CSD.zip, verifies md5, and writes local registry evidence', async () => {
    const root = mkdtempSync(join(tmpdir(), 'webuta-csd-download-'))
    roots.push(root)
    const server = await fixtureServer()

    try {
      const outDir = join(root, 'csd')
      const manifest = await downloadCsd({
        outDir,
        recordUrl: `http://127.0.0.1:${server.port}/api/records/4916302`,
      })

      expect(manifest.source).toBe('zenodo:4916302')
      expect(manifest.file).toMatchObject({
        key: 'CSD.zip',
        expectedMd5: md5('fake-csd-zip'),
        md5: md5('fake-csd-zip'),
        status: 'downloaded',
      })
      expect(manifest.extracted.ready).toBe(false)

      const registry = JSON.parse(readFileSync(join(outDir, 'dataset-registry.local.json'), 'utf8'))
      expect(registry.datasets[0]).toMatchObject({
        id: 'csd-korean-research-baseline',
        licenseStatus: 'cc-by-nc-sa-4.0-research-only',
        allowedActions: {
          localTraining: true,
          publicModelRelease: false,
        },
      })
    } finally {
      await server.close()
    }
  })
})

async function fixtureServer() {
  const zipBody = 'fake-csd-zip'
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1')
    if (url.pathname === '/api/records/4916302') {
      writeJson(response, {
        id: 4916302,
        doi: '10.5281/zenodo.4916302',
        metadata: {
          license: {
            id: 'cc-by-nc-sa-4.0',
          },
        },
        files: [
          {
            key: 'CSD.zip',
            size: Buffer.byteLength(zipBody),
            checksum: `md5:${md5(zipBody)}`,
            links: {
              self: `http://127.0.0.1:${server.address().port}/files/CSD.zip/content`,
            },
          },
        ],
      })
      return
    }
    if (url.pathname === '/files/CSD.zip/content') {
      response.writeHead(200, { 'content-type': 'application/zip' })
      response.end(zipBody)
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

function writeJson(response, value) {
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify(value))
}

function md5(value) {
  return createHash('md5').update(value).digest('hex')
}
