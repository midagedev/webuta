import JSZip from 'jszip'
import { sanitizeFileName } from './music'
import { serializeWebutaProject } from './projectFile'
import { serializeUst } from './ust'
import { serializeUstx } from './ustx'
import type { RenderedAudio, SongProject } from './types'

export const DAW_HANDOFF_BUNDLE_FORMAT = 'webuta-daw-handoff-bundle'
export const DAW_HANDOFF_BUNDLE_VERSION = 1

export type DawHandoffBundleOptions = {
  project: SongProject
  rendered: RenderedAudio
  voicebankName: string
  rendererName: string
  exportedAt?: string
}

export type DawHandoffBundle = {
  blob: Blob
  fileName: string
}

export async function createDawHandoffBundle(options: DawHandoffBundleOptions): Promise<DawHandoffBundle> {
  const exportedAt = options.exportedAt ?? new Date().toISOString()
  const baseName = sanitizeFileName(options.project.name)
  const files = {
    wav: `audio/${baseName}.wav`,
    webuta: `project/${baseName}.webutau.json`,
    ustx: `project/${baseName}.ustx`,
    ust: `project/${baseName}.ust`,
    manifest: 'manifest.json',
    readme: 'README.txt',
  }
  const manifest = {
    format: DAW_HANDOFF_BUNDLE_FORMAT,
    version: DAW_HANDOFF_BUNDLE_VERSION,
    exportedAt,
    project: {
      id: options.project.id,
      name: options.project.name,
      bpm: options.project.bpm,
      beatPerBar: options.project.beatPerBar,
      beatUnit: options.project.beatUnit,
      noteCount: options.project.notes.length,
    },
    voicebank: options.voicebankName,
    renderer: options.rendererName,
    wav: {
      file: files.wav,
      sampleRate: options.rendered.wavInfo.sampleRate,
      channels: options.rendered.wavInfo.channelCount,
      bitsPerSample: options.rendered.wavInfo.bitsPerSample,
      durationSeconds: options.rendered.wavInfo.durationSeconds,
      bytes: options.rendered.wavInfo.dataBytes + 44,
    },
    files,
  }

  const zip = new JSZip()
  zip.file(files.wav, await options.rendered.blob.arrayBuffer())
  zip.file(files.webuta, serializeWebutaProject(options.project, exportedAt))
  zip.file(files.ustx, serializeUstx(options.project))
  zip.file(files.ust, serializeUst(options.project))
  zip.file(files.manifest, `${JSON.stringify(manifest, null, 2)}\n`)
  zip.file(files.readme, createBundleReadme(options, files))

  const bytes = await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })

  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer

  return {
    blob: new Blob([arrayBuffer], { type: 'application/zip' }),
    fileName: `${baseName}-daw-handoff.zip`,
  }
}

function createBundleReadme(options: DawHandoffBundleOptions, files: Record<string, string>) {
  return [
    `${options.project.name} - WebUtau DAW handoff`,
    '',
    'Files:',
    `- ${files.wav}: rendered vocal audio, 44.1 kHz mono 16-bit PCM when the DAW-ready check passes.`,
    `- ${files.webuta}: native WebUtau project backup.`,
    `- ${files.ustx}: OpenUtau/USTX project export.`,
    `- ${files.ust}: classic UTAU project export.`,
    `- ${files.manifest}: machine-readable bundle metadata.`,
    '',
    `Voicebank: ${options.voicebankName}`,
    `Renderer: ${options.rendererName}`,
    '',
    'Import the WAV into a DAW for arrangement. Keep the project files with the audio if you want to revise lyrics, timing, or notes later.',
    '',
  ].join('\n')
}
