// A small key-value store in IndexedDB for what is too big for localStorage: imported workbooks (a 1,900-row
// list is ~600 KB of text) and campaign attachments (up to 18 MB). Where IndexedDB is unavailable (a private
// window, a test runner) it keeps values in memory for the session and says nothing — callers treat a miss as
// "not saved", never as an error.

const DB = 'esb-outreach'
const STORE = 'kv'
const memory = new Map<string, unknown>()
let opening: Promise<IDBDatabase | null> | null = null

function open(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  return (opening ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1)
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE) }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
    } catch { resolve(null) }
  }))
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T | undefined> {
  return open().then((db) => new Promise<T | undefined>((resolve) => {
    if (!db) return resolve(undefined)
    try {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE))
      req.onsuccess = () => resolve(req.result as T)
      req.onerror = () => resolve(undefined)
    } catch { resolve(undefined) }
  }))
}

export async function idbGet<T>(key: string): Promise<T | undefined> {
  const v = await run<T>('readonly', (s) => s.get(key))
  return v === undefined ? (memory.get(key) as T | undefined) : v
}
export async function idbSet(key: string, value: unknown): Promise<void> {
  memory.set(key, value)
  await run('readwrite', (s) => s.put(value, key))
}
export async function idbDel(key: string): Promise<void> {
  memory.delete(key)
  await run('readwrite', (s) => s.delete(key))
}
