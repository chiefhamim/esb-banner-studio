// Where the scripts aim and with which secrets.
//   Local (wrangler dev): read from .dev.vars.
//   Live: from the environment, else from ~/.config/esb-mail-tracker/secrets.env (outside the repo, written at deploy).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { join } from 'node:path'

function readVars(file) {
  const out = {}
  try {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^(\w+)=(.*)$/)
      if (m) out[m[1]] = m[2]
    }
  } catch {}
  return out
}

export const SECRETS_FILE = join(homedir(), '.config', 'esb-mail-tracker', 'secrets.env')

export function target(argv = process.argv.slice(2)) {
  const base = (argv.find((a) => /^https?:\/\//.test(a)) ?? 'http://127.0.0.1:8787').replace(/\/$/, '')
  const local = /\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(base)
  const file = local ? readVars(fileURLToPath(new URL('../../.dev.vars', import.meta.url))) : readVars(SECRETS_FILE)
  const secret = process.env.TRACK_SECRET || file.TRACK_SECRET
  const token = process.env.API_TOKEN || file.API_TOKEN
  if (!secret || !token) {
    console.error(`No TRACK_SECRET / API_TOKEN (environment or ${local ? '.dev.vars' : SECRETS_FILE}).`)
    process.exit(2)
  }
  const opt = (name, def) => {
    const a = argv.find((x) => x.startsWith(`--${name}=`))
    return a ? Number(a.split('=')[1]) : def
  }
  const api = (path, init = {}) => fetch(base + path, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) } })
  return { base, local, secret, token, opt, api }
}

export const UA_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

export function pct(sorted, p) {
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0
}

/** Run `jobs` with at most `n` in flight. */
export async function pool(jobs, n) {
  const out = new Array(jobs.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, async () => {
    while (i < jobs.length) {
      const k = i++
      out[k] = await jobs[k]()
    }
  }))
  return out
}
