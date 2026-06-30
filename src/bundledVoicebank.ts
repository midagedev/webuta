export const BUNDLED_UTAU_VOICEBANK_NAME = 'WebUtau Korean V3 Synthetic'
export const BUNDLED_UTAU_VOICEBANK_FILE = 'webuta-ko-v3.zip'
export const BUNDLED_UTAU_VOICEBANK_VERSION = '20260701-v3-synthetic-web-3'

export const BUNDLED_KOREAN_LITE_VOICEBANK_NAME = BUNDLED_UTAU_VOICEBANK_NAME
export const BUNDLED_KOREAN_LITE_VOICEBANK_FILE = BUNDLED_UTAU_VOICEBANK_FILE
export const BUNDLED_KOREAN_LITE_VOICEBANK_VERSION = BUNDLED_UTAU_VOICEBANK_VERSION

export async function loadBundledUtauVoicebankFile() {
  const url = new URL(`${import.meta.env.BASE_URL}voicebanks/${BUNDLED_UTAU_VOICEBANK_FILE}`, window.location.href)
  url.searchParams.set('v', BUNDLED_UTAU_VOICEBANK_VERSION)
  const response = await fetch(url, { cache: 'no-cache' })
  if (!response.ok) {
    throw new Error(`Bundled voicebank could not be loaded: ${response.status}`)
  }
  const blob = await response.blob()
  return new File([blob], BUNDLED_UTAU_VOICEBANK_FILE, {
    type: 'application/zip',
    lastModified: Date.UTC(2026, 0, 1),
  })
}

export const loadBundledKoreanLiteVoicebankFile = loadBundledUtauVoicebankFile
