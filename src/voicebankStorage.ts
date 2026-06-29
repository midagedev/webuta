const DB_NAME = 'webuta-voicebank'
const DB_VERSION = 1
const STORE_NAME = 'voicebanks'
const LAST_VOICEBANK_ID = 'last'

type StoredVoicebankFile = {
  id: typeof LAST_VOICEBANK_ID
  name: string
  type: string
  lastModified: number
  savedAt: string
  bytes: ArrayBuffer
}

export async function saveVoicebankFile(file: File) {
  try {
    const db = await openVoicebankDb()
    if (!db) {
      return false
    }
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).put({
      id: LAST_VOICEBANK_ID,
      name: file.name,
      type: file.type || 'application/zip',
      lastModified: file.lastModified,
      savedAt: new Date().toISOString(),
      bytes: await file.arrayBuffer(),
    } satisfies StoredVoicebankFile)
    await transactionDone(transaction)
    db.close()
    return true
  } catch {
    return false
  }
}

export async function loadSavedVoicebankFile() {
  try {
    const db = await openVoicebankDb()
    if (!db) {
      return null
    }
    const transaction = db.transaction(STORE_NAME, 'readonly')
    const stored = await requestResult<StoredVoicebankFile | undefined>(
      transaction.objectStore(STORE_NAME).get(LAST_VOICEBANK_ID),
    )
    await transactionDone(transaction)
    db.close()
    if (!isStoredVoicebankFile(stored)) {
      return null
    }
    return new File([new Uint8Array(stored.bytes)], stored.name, {
      type: stored.type,
      lastModified: stored.lastModified,
    })
  } catch {
    return null
  }
}

export async function clearSavedVoicebankFile() {
  try {
    const db = await openVoicebankDb()
    if (!db) {
      return false
    }
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).delete(LAST_VOICEBANK_ID)
    await transactionDone(transaction)
    db.close()
    return true
  } catch {
    return false
  }
}

function openVoicebankDb() {
  const indexedDb = getIndexedDb()
  if (!indexedDb) {
    return Promise.resolve(null)
  }
  return new Promise<IDBDatabase | null>((resolve) => {
    const request = indexedDb.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
    request.onblocked = () => resolve(null)
  })
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function getIndexedDb() {
  try {
    return globalThis.indexedDB ?? null
  } catch {
    return null
  }
}

function isStoredVoicebankFile(value: unknown): value is StoredVoicebankFile {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const record = value as Record<string, unknown>
  return (
    record.id === LAST_VOICEBANK_ID &&
    typeof record.name === 'string' &&
    typeof record.type === 'string' &&
    typeof record.lastModified === 'number' &&
    typeof record.savedAt === 'string' &&
    isArrayBufferLike(record.bytes)
  )
}

function isArrayBufferLike(value: unknown): value is ArrayBuffer {
  return Object.prototype.toString.call(value) === '[object ArrayBuffer]' && typeof (value as ArrayBuffer).byteLength === 'number'
}
