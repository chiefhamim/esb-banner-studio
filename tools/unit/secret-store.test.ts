import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createSecretStore, ALLOWED_KEYS } from '../../electron/secret-store.cjs'

describe('createSecretStore', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esb-secrets-test-'))
  })

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      // ignore cleanup errors
    }
  })

  it('allows reading and writing permitted keys with simulated encryption', () => {
    const fakeSafeStorage = {
      isEncryptionAvailable: () => true,
      encryptString: (s: string) => Buffer.from(`enc_${s}`),
      decryptString: (b: Buffer) => b.toString().replace(/^enc_/, ''),
    }

    const store = createSecretStore({ dir: tmpDir, safeStorage: fakeSafeStorage })
    expect(store.isAvailable()).toBe(true)

    const payload = JSON.stringify({ gemini: 'test-key-123' })
    expect(store.set('ai-settings', payload)).toBe(true)

    const retrieved = store.get('ai-settings')
    expect(retrieved).toBe(payload)

    // Verify written file does not contain plaintext secret directly
    const rawFile = fs.readFileSync(path.join(tmpDir, 'app-secrets.json'), 'utf8')
    expect(rawFile).not.toContain('test-key-123')
  })

  it('rejects keys not in the allowlist', () => {
    const store = createSecretStore({ dir: tmpDir, safeStorage: null })
    expect(() => store.set('random-attacker-key', 'secret')).toThrow(/not permitted/)
    expect(store.get('random-attacker-key')).toBe(null)
  })

  it('deletes key when setting null or empty string', () => {
    const store = createSecretStore({ dir: tmpDir, safeStorage: null })
    store.set('facebook', 'fb-token-999')
    expect(store.get('facebook')).toBe('fb-token-999')

    store.set('facebook', '')
    expect(store.get('facebook')).toBe(null)
  })

  it('gracefully handles missing or unencrypted environments', () => {
    const store = createSecretStore({ dir: tmpDir, safeStorage: null })
    expect(store.isAvailable()).toBe(false)
    store.set('staff-session', 'user-session-token')
    expect(store.get('staff-session')).toBe('user-session-token')
  })
})
