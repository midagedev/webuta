import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { downloadGTSingerKorean } from './download-gtsinger-korean.mjs'

describe('GTSinger Korean downloader', () => {
  const roots = []

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('downloads Korean files, repo docs, registry, and SHA-256 manifest', async () => {
    const root = mkdtempSync(join(tmpdir(), 'webuta-gtsinger-download-'))
    roots.push(root)
    const server = await fixtureServer()

    try {
      const outDir = join(root, 'gtsinger-korean')
      const base = `http://127.0.0.1:${server.port}`
      const manifest = await downloadGTSingerKorean({
        outDir,
        apiBase: `${base}/api`,
        resolveBase: `${base}/resolve`,
      })

      expect(manifest.source).toBe('huggingface:GTSinger/GTSinger')
      expect(manifest.metrics.fileCount).toBe(7)
      expect(manifest.metrics.wavCount).toBe(2)
      expect(manifest.metrics.presentFileCount).toBe(7)
      expect(manifest.files.find((file) => file.path === 'Korean/KO-Soprano-1/song-a.wav')?.sha256).toBe(
        sha256('fake-wave-data'),
      )
      expect(manifest.files.find((file) => file.path === 'Korean/KO-Soprano-1/song-b.wav')?.sha256).toBe(
        sha256('fake-wave-data-b'),
      )

      const registry = JSON.parse(readFileSync(join(outDir, 'dataset-registry.local.json'), 'utf8'))
      expect(registry.datasets[0]).toMatchObject({
        id: 'gtsinger-korean-research-baseline',
        inventoryRoots: ['Korean', 'processed/Korean'],
        licenseStatus: 'cc-by-nc-sa-4.0-research-only',
        allowedActions: {
          localTraining: true,
          publicModelRelease: false,
        },
      })
      expect(readFileSync(join(outDir, 'repository', 'dataset_license.md'), 'utf8')).toContain('CC BY-NC-SA 4.0')
    } finally {
      await server.close()
    }
  })

  it('can summarize an existing repository checkout without copying it into the dataset folder', async () => {
    const root = mkdtempSync(join(tmpdir(), 'webuta-gtsinger-existing-'))
    roots.push(root)
    const server = await fixtureServer()

    try {
      const outDir = join(root, 'gtsinger-korean')
      const repositoryDir = join(root, 'external-gtsinger-lfs')
      mkdirSync(join(repositoryDir, 'Korean', 'KO-Soprano-1'), { recursive: true })
      writeFileSync(join(repositoryDir, 'Korean', 'KO-Soprano-1', 'song-a.wav'), 'fake-wave-data')

      const base = `http://127.0.0.1:${server.port}`
      const manifest = await downloadGTSingerKorean({
        outDir,
        repositoryDir,
        apiBase: `${base}/api`,
        resolveBase: `${base}/resolve`,
        skipDownload: true,
      })

      expect(manifest.repositoryDir).toBe(repositoryDir)
      expect(manifest.metrics.fileCount).toBe(7)
      expect(manifest.metrics.presentFileCount).toBe(1)
      expect(manifest.files.find((file) => file.path === 'Korean/KO-Soprano-1/song-a.wav')?.status).toBe(
        'present-skip-download',
      )
      expect(manifest.files.find((file) => file.path === 'Korean/KO-Soprano-1/song-b.wav')?.status).toBe('planned')

      const registry = JSON.parse(readFileSync(join(outDir, 'dataset-registry.local.json'), 'utf8'))
      expect(registry.datasets[0].localPath).toBe(repositoryDir)
      expect(registry.datasets[0].inventoryRoots).toEqual(['Korean', 'processed/Korean'])
    } finally {
      await server.close()
    }
  })
})

async function fixtureServer() {
  const files = new Map([
    ['Korean/KO-Soprano-1/song-a.wav', 'fake-wave-data'],
    ['Korean/KO-Soprano-1/song-a.json', '{"lyric":"안녕"}'],
    ['Korean/KO-Soprano-1/song-b.wav', 'fake-wave-data-b'],
    ['processed/Korean/metadata.json', '{"segments":[]}'],
    ['processed/Korean/phone_set.json', '["a"]'],
    ['README.md', '# GTSinger'],
    ['dataset_license.md', 'CC BY-NC-SA 4.0'],
  ])
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1')
    if (url.pathname === '/api/Korean' && !url.searchParams.has('cursor')) {
      response.setHeader('link', `<http://127.0.0.1:${server.address().port}/api/Korean?cursor=page-2>; rel="next"`)
      writeJson(response, [
        entry('Korean/KO-Soprano-1/song-a.wav', files),
        entry('Korean/KO-Soprano-1/song-a.json', files),
      ])
      return
    }
    if (url.pathname === '/api/Korean' && url.searchParams.get('cursor') === 'page-2') {
      writeJson(response, [entry('Korean/KO-Soprano-1/song-b.wav', files)])
      return
    }
    if (url.pathname === '/api/processed/Korean') {
      writeJson(response, [entry('processed/Korean/metadata.json', files), entry('processed/Korean/phone_set.json', files)])
      return
    }
    if (url.pathname.startsWith('/resolve/')) {
      const path = decodeURIComponent(url.pathname.slice('/resolve/'.length))
      const body = files.get(path)
      if (body == null) {
        response.writeHead(404)
        response.end('missing')
        return
      }
      response.writeHead(200, { 'content-type': 'application/octet-stream' })
      response.end(body)
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

function entry(path, files) {
  return {
    type: 'file',
    path,
    size: Buffer.byteLength(files.get(path)),
  }
}

function writeJson(response, value) {
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify(value))
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}
