export type WavInfo = {
  container: 'RIFF/WAVE'
  audioFormat: number
  formatName: 'PCM' | 'FLOAT' | 'UNKNOWN'
  channelCount: number
  sampleRate: number
  bitsPerSample: number
  dataBytes: number
  durationSeconds: number
}

export function encodeWav(samples: Float32Array, sampleRate: number) {
  const bytesPerSample = 2
  const blockAlign = bytesPerSample
  const dataSize = samples.length * bytesPerSample
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataSize, true)

  let offset = 44
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample))
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true)
    offset += bytesPerSample
  }

  return new Blob([buffer], { type: 'audio/wav' })
}

export async function inspectWavBlob(blob: Blob) {
  return inspectWavBuffer(await blob.arrayBuffer())
}

export function inspectWavBuffer(buffer: ArrayBuffer): WavInfo {
  const view = new DataView(buffer)
  if (view.byteLength < 44 || readAscii(view, 0, 4) !== 'RIFF' || readAscii(view, 8, 4) !== 'WAVE') {
    throw new Error('Invalid WAV container')
  }

  let fmtOffset = -1
  let fmtSize = 0
  let dataBytes = 0
  let offset = 12
  while (offset + 8 <= view.byteLength) {
    const chunkId = readAscii(view, offset, 4)
    const chunkSize = view.getUint32(offset + 4, true)
    const chunkDataOffset = offset + 8
    if (chunkId === 'fmt ') {
      fmtOffset = chunkDataOffset
      fmtSize = chunkSize
    }
    if (chunkId === 'data') {
      dataBytes = chunkSize
      break
    }
    offset += 8 + chunkSize + (chunkSize % 2)
  }

  if (fmtOffset < 0 || fmtSize < 16 || dataBytes <= 0) {
    throw new Error('Missing WAV fmt or data chunk')
  }

  const audioFormat = view.getUint16(fmtOffset, true)
  const channelCount = view.getUint16(fmtOffset + 2, true)
  const sampleRate = view.getUint32(fmtOffset + 4, true)
  const byteRate = view.getUint32(fmtOffset + 8, true)
  const blockAlign = view.getUint16(fmtOffset + 12, true)
  const bitsPerSample = view.getUint16(fmtOffset + 14, true)
  const durationSeconds = byteRate > 0 ? dataBytes / byteRate : 0

  if (blockAlign === 0 || channelCount === 0 || sampleRate === 0 || bitsPerSample === 0) {
    throw new Error('Invalid WAV fmt values')
  }

  return {
    container: 'RIFF/WAVE',
    audioFormat,
    formatName: formatName(audioFormat),
    channelCount,
    sampleRate,
    bitsPerSample,
    dataBytes,
    durationSeconds,
  }
}

export function isDawReadyWav(info: WavInfo) {
  return (
    info.container === 'RIFF/WAVE' &&
    info.audioFormat === 1 &&
    info.channelCount === 1 &&
    info.sampleRate === 44100 &&
    info.bitsPerSample === 16 &&
    info.dataBytes > 0 &&
    info.durationSeconds > 0
  )
}

function writeAscii(view: DataView, offset: number, text: string) {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i))
  }
}

function readAscii(view: DataView, offset: number, length: number) {
  let text = ''
  for (let i = 0; i < length; i++) {
    text += String.fromCharCode(view.getUint8(offset + i))
  }
  return text
}

function formatName(audioFormat: number): WavInfo['formatName'] {
  if (audioFormat === 1) {
    return 'PCM'
  }
  if (audioFormat === 3) {
    return 'FLOAT'
  }
  return 'UNKNOWN'
}
