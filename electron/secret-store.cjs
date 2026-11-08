// ESB Studio — encrypted secrets store for renderer credentials (main process only).
// Protects API keys (Gemini, Claude, OpenAI), Facebook tokens, and staff sessions using OS safeStorage (DPAPI).
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const ALLOWED_KEYS = new Set([
  'ai-settings',
  'facebook',
  'staff-session',
])

const MAX_VALUE_BYTES = 512 * 1024 // 512 KB

function createSecretStore({ dir, safeStorage }) {
  if (!dir) throw new Error('createSecretStore requires dir')
  const file = path.join(dir, 'app-secrets.json')

  const canEncrypt = () => {
    try {
      return !!(safeStorage && typeof safeStorage.isEncryptionAvailable === 'function' && safeStorage.isEncryptionAvailable())
    } catch {
      return false
    }
  }

  const readStore = () => {
    try {
      if (!fs.existsSync(file)) return {}
      const raw = fs.readFileSync(file, 'utf8')
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }

  const writeStore = (data) => {
    fs.mkdirSync(dir, { recursive: true })
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(data), 'utf8')
    fs.renameSync(tmp, file)
  }

  const seal = (plain) => {
    if (!canEncrypt()) {
      // In environments where OS keychain is unavailable (e.g. CI / dev sandbox without DPAPI),
      // prefix with plaintext marker so store still functions without data loss.
      return 'raw:' + Buffer.from(plain, 'utf8').toString('base64')
    }
    return 'enc:' + safeStorage.encryptString(plain).toString('base64')
  }

  const unseal = (stored) => {
    if (typeof stored !== 'string') return null
    try {
      if (stored.startsWith('enc:')) {
        const cipherB64 = stored.slice(4)
        return safeStorage.decryptString(Buffer.from(cipherB64, 'base64'))
      }
      if (stored.startsWith('raw:')) {
        return Buffer.from(stored.slice(4), 'base64').toString('utf8')
      }
      // Legacy un-prefixed
      if (canEncrypt()) {
        try {
          return safeStorage.decryptString(Buffer.from(stored, 'base64'))
        } catch {
          return null
        }
      }
      return null
    } catch {
      return null
    }
  }

  return {
    isAvailable: () => canEncrypt(),
    get: (key) => {
      if (!ALLOWED_KEYS.has(key)) return null
      const store = readStore()
      const val = store[key]
      if (!val) return null
      return unseal(val)
    },
    set: (key, val) => {
      if (!ALLOWED_KEYS.has(key)) throw new Error(`Secret key "${key}" is not permitted`)
      const store = readStore()
      if (val === null || val === undefined || val === '') {
        delete store[key]
        writeStore(store)
        return true
      }
      if (typeof val !== 'string') throw new Error('Secret value must be a string')
      if (Buffer.byteLength(val, 'utf8') > MAX_VALUE_BYTES) throw new Error('Secret value exceeds maximum size limit')
      store[key] = seal(val)
      writeStore(store)
      return true
    },
  }
}

module.exports = {
  createSecretStore,
  ALLOWED_KEYS,
  MAX_VALUE_BYTES,
}
