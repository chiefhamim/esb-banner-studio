// Shared browser launch helper for tools/*.mjs Playwright scripts.
// Tries real Edge (Windows dev box), then Playwright's own managed Chromium,
// then falls back to a locally installed Chromium binary (Linux cloud/CI
// containers that pre-install a browser at a revision Playwright's registry
// doesn't recognise) before giving up.
import fs from 'node:fs'
import path from 'node:path'

function findLocalChromium() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (!root || !fs.existsSync(root)) return null
  let entries = []
  try {
    entries = fs.readdirSync(root)
  } catch {
    return null
  }
  const dirs = entries.filter((e) => /^chromium-\d+/.test(e)).sort().reverse()
  for (const dir of dirs) {
    const candidates = [
      path.join(root, dir, 'chrome-linux64', 'chrome'),
      path.join(root, dir, 'chrome-linux', 'chrome'),
      path.join(root, dir, 'chrome-win64', 'chrome.exe'),
      path.join(root, dir, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
    ]
    for (const exe of candidates) {
      if (fs.existsSync(exe)) return exe
    }
  }
  return null
}

export async function launchBrowser(chromium, opts = {}) {
  try {
    return await chromium.launch({ channel: 'msedge', headless: true, ...opts })
  } catch {}
  try {
    return await chromium.launch({ headless: true, ...opts })
  } catch (err) {
    const exe = findLocalChromium()
    if (!exe) throw err
    return await chromium.launch({ executablePath: exe, headless: true, ...opts })
  }
}
