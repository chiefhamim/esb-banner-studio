// Per-checkout port offset for the Playwright runners in tools/.
//
// Every runner spawns Vite on a fixed port and then polls http://localhost:<port> until it answers. With two
// checkouts (git worktrees) running suites at the same time, the second runner's Vite fails on the busy port
// and the poll then succeeds against the *other* checkout's server — the suite silently tests someone else's
// code. A checkout that wants its own ports writes a number to `<repo root>/.esb-port-offset` (git-ignored);
// every runner adds it to its base port. No file = offset 0 = exactly the ports the runners always used.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function portOffset() {
  const env = process.env.ESB_PORT_OFFSET
  if (env !== undefined && env !== '') {
    const n = Number(env)
    if (Number.isInteger(n) && n >= 0 && n < 10000) return n
  }
  try {
    const n = Number(fs.readFileSync(path.join(root, '.esb-port-offset'), 'utf8').trim())
    if (Number.isInteger(n) && n >= 0 && n < 10000) return n
  } catch {
    /* no file: the default ports */
  }
  return 0
}
