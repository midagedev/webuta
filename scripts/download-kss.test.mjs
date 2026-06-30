import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { downloadKss } from './download-kss.mjs'

describe('KSS downloader', () => {
  const roots = []

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('downloads parquet shards and writes auxiliary speech registry evidence', async () => {
    const root = mkdtempSync(join(tmpdir(), 'webuta-kss-download-'))
    roots.push(root)
    const server = await fixtureServer()

    try {
      const outDir = join(root, 'kss')
      const manifest = await downloadKss({
        outDir,
        apiUrl: `http://127.0.0.1:${server.port}/api/datasets/Bingsu/KSS_Dataset`,
        resolveBase: `http://127.0.0.1:${server.port}/resolve`,
      })

      expect(manifest.metrics).toMatchObject({
        fileCount: 4,
        presentFileCount: 4,
        parquetCount: 2,
        totalExpectedBytes: Buffer.byteLength('readme') + Buffer.byteLength('infos') + Buffer.byteLength('p0') + Buffer.byteLength('p1'),
      })
      expect(manifest.files.find((file) => file.path.endsWith('.parquet')).sha256).toBe(sha256('p0'))

      const registry = JSON.parse(readFileSync(join(outDir, 'dataset-registry.local.json'), 'utf8'))
      expect(registry.datasets[0]).toMatchObject({
        id: 'kss-korean-speech-pronunciation-aux',
        licenseStatus: 'cc-by-nc-sa-4.0-research-only',
        allowedActions: {
          localTraining: false,
          publicModelRelease: false,
        },
      })
    } finally {
      await server.close()
    }
  })
})

async function fixtureServer() {
  const bodies = new Map([
    ['README.md', 'readme'],
    ['dataset_infos.json', 'infos'],
    ['data/train-00000-of-00002.parquet', 'p0'],
    ['data/train-00001-of-00002.parquet', 'p1'],
  ])
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1')
    if (url.pathname === '/api/datasets/Bingsu/KSS_Dataset') {
      writeJson(response, {
        sha: 'fixture-sha',
        siblings: [...bodies.keys()].map((rfilename) => ({ rfilename })),
      })
      return
    }
    const path = decodeURIComponent(url.pathname.replace(/^\/resolve\//u, ''))
    if (bodies.has(path)) {
      const body = bodies.get(path)
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': Buffer.byteLength(body),
        etag: `"${sha256(body)}"`,
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

function writeJson(response, value) {
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify(value))
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}
