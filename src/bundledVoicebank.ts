export const BUNDLED_KOREAN_LITE_VOICEBANK_NAME = 'WebUtau Korean Lite'
export const BUNDLED_KOREAN_LITE_VOICEBANK_FILE = 'webuta-ko-lite.zip'

export async function loadBundledKoreanLiteVoicebankFile() {
  const url = new URL(`${import.meta.env.BASE_URL}voicebanks/${BUNDLED_KOREAN_LITE_VOICEBANK_FILE}`, window.location.href)
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Bundled voicebank could not be loaded: ${response.status}`)
  }
  const blob = await response.blob()
  return new File([blob], BUNDLED_KOREAN_LITE_VOICEBANK_FILE, {
    type: 'application/zip',
    lastModified: Date.UTC(2026, 0, 1),
  })
}
