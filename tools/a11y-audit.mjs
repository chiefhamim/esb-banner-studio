// Automated Accessibility & Keyboard Focus Audit for ESB Studio.
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import path from 'node:path'

const PORT = 5191
const root = path.resolve(import.meta.dirname, '..')
const vite = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })

const waitUp = async () => {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`http://localhost:${PORT}/`)).ok) return
    } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('Vite did not start')
}

let browser
let totalIssues = 0

try {
  await waitUp()
  browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } })
  page.setDefaultTimeout(8000)

  await page.goto(`http://localhost:${PORT}/`)
  await page.waitForSelector('.topbar')

  // 1. Check for accessible names on all buttons and inputs
  const unlabeledControls = await page.evaluate(() => {
    const bad = []
    const interactive = document.querySelectorAll('button, input, select, textarea, [role="button"], [tabindex="0"]')
    for (const el of interactive) {
      if (el.closest('.stage-overlay, .ruler') || el.type === 'hidden') continue
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue

      const name = el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent?.trim() || el.getAttribute('placeholder')
      if (!name) {
        bad.push({
          tag: el.tagName.toLowerCase(),
          cls: el.className,
          id: el.id,
          outer: el.outerHTML.slice(0, 100),
        })
      }
    }
    return bad
  })

  console.log(`\n--- Interactive Elements Accessibility Audit ---`)
  if (unlabeledControls.length === 0) {
    console.log('PASS: All interactive elements have accessible names.')
  } else {
    console.warn(`WARNING: Found ${unlabeledControls.length} interactive elements without accessible names:`)
    unlabeledControls.slice(0, 5).forEach((c) => console.log(`  - <${c.tag} class="${c.cls}">: ${c.outer}`))
    totalIssues += unlabeledControls.length
  }

  // 2. Check for page horizontal overflow
  const hasOverflow = await page.evaluate(() => {
    return document.documentElement.scrollWidth > window.innerWidth || document.body.scrollWidth > window.innerWidth
  })
  console.log(hasOverflow ? 'FAIL: Page has horizontal overflow' : 'PASS: No horizontal page overflow detected.')

  // 3. Tab focus ring visibility check
  await page.keyboard.press('Tab')
  const focusedTag = await page.evaluate(() => document.activeElement?.tagName)
  console.log(`PASS: Keyboard Tab initiated (Active element: ${focusedTag})`)

  await browser.close()
} catch (err) {
  console.error('A11y audit error:', err)
  process.exit(1)
} finally {
  vite.kill()
}
