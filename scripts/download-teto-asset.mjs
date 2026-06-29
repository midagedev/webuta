import { createWriteStream, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { finished } from 'node:stream/promises'

const url = 'https://kasaneteto.jp/assets/download/utau/TETO-OUset240323.zip'
const output = join(process.cwd(), 'test-assets', 'TETO-OUset240323.zip')

if (existsSync(output)) {
  console.log(`Already exists: ${output}`)
  process.exit(0)
}

mkdirSync(dirname(output), { recursive: true })

const response = await fetch(url)
if (!response.ok || !response.body) {
  throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`)
}

console.log(`Downloading ${url}`)
await finished(Readable.fromWeb(response.body).pipe(createWriteStream(output)))
console.log(`Saved ${output}`)
