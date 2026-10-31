import { execSync } from 'child_process'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

try {
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const projectRoot = resolve(__dirname, '../..')

  let data = {}
  if (!process.stdin.isTTY) {
    try {
      const input = readFileSync(0, 'utf8')
      if (input && input.trim()) {
        data = JSON.parse(input)
      }
    } catch {}
  }

  // If invoked interactively or by agy on stop with NO_TOOL_CALL
  if (process.stdin.isTTY || data.terminationReason === 'NO_TOOL_CALL') {
    try {
      execSync('npx oxlint --quiet', { cwd: projectRoot, stdio: 'pipe', encoding: 'utf8' })
    } catch (err) {
      const output = ((err.stdout || '') + (err.stderr || '')).trim()
      if (err.status !== 0 && output) {
        process.stdout.write(JSON.stringify({
          decision: 'continue',
          reason: `oxlint detected issues that must be addressed:\n${output}`
        }))
        process.exit(0)
      }
    }
  }

  process.stdout.write(JSON.stringify({ decision: 'stop' }))
} catch {
  process.stdout.write(JSON.stringify({ decision: 'stop' }))
}
