// One command for the Video accessibility audit: every Video state in both themes at 900 and 1920 px (the screenshot harness
// in audit-only mode), then the summary. Exit 1 on any finding in contrast, targets under 24 px, unnamed controls or missing
// focus rings. ~30 minutes. WIDTHS / THEMES / STATES narrow it.
//   node tools/audit/video-a11y.mjs [outDir]
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '../..')
const out = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'esb-video-a11y-'))
const env = { ...process.env, AUDIT: '1', AUDIT_ONLY: '1', OUT: out, WIDTHS: process.env.WIDTHS || '900,1920', THEMES: process.env.THEMES || 'light,dark' }
const run = spawnSync(process.execPath, [path.join(root, 'tools/e2e/video-shots.mjs')], { cwd: root, env, stdio: 'inherit' })
if (run.status !== 0 && !fs.existsSync(path.join(out, 'manifest.json'))) process.exit(run.status ?? 1)
const sum = spawnSync(process.execPath, [path.join(root, 'tools/audit/video-a11y-summary.mjs'), out], { cwd: root, stdio: 'inherit' })
process.exit(sum.status ?? 1)
