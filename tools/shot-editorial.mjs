// Screenshot Graphics and Editorial (with a fixture story loaded) at several window sizes.
// Usage: node tools/shot-editorial.mjs <outDir> [label]
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { launchBrowser } from './launch-browser.mjs'

const PORT = 5197
const root = path.resolve(import.meta.dirname, '..')
const out = process.argv[2] || '.'
const label = process.argv[3] || 'shot'
const vite = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })
const waitUp = async () => { for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) return } catch {} await new Promise((r) => setTimeout(r, 500)) } throw new Error('vite') }
let browser
try {
  await waitUp()
  browser = await launchBrowser(chromium)
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
  await page.addInitScript(() => { window.__customTranslator = async (t) => t.replace(/[ঀ-৿]+/g, 'word') })
  const fixturePhoto = path.join(root, 'tools', 'fixtures', 'media', 'synthetic-rig.jpg')
  await page.route('**/media/**', (r) => r.fulfill({ path: fixturePhoto, contentType: 'image/jpeg' }))
  await page.goto(`http://localhost:${PORT}/`)
  await page.waitForSelector('.studio-shell')
  for (const [w, h] of [[1920, 1080], [1366, 768]]) {
    await page.setViewportSize({ width: w, height: h })
    await page.waitForTimeout(400)
    await page.screenshot({ path: path.join(out, `${label}-graphics-${w}.png`) })
  }
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.click('.rail-btn:has-text("Editorial")')
  await page.waitForSelector('.editorial-workspace')
  if (await page.locator('.ed-url-input').count()) {
    await page.screenshot({ path: path.join(out, `${label}-launcher-1920.png`) })
    await page.fill('.ed-url-input', `http://localhost:${PORT}/tools/fixtures/jsonld-news.html`)
    await page.click('button:has-text("Fetch & Auto-Translate")')
    await page.waitForSelector('.ed-extract-report', { timeout: 30000 })
    await page.waitForTimeout(1500)
  }
  for (const [w, h] of [[1920, 1080], [1366, 768], [1100, 720]]) {
    await page.setViewportSize({ width: w, height: h })
    await page.waitForTimeout(500)
    await page.screenshot({ path: path.join(out, `${label}-editorial-${w}.png`) })
  }
  // featured image: pick the first story photo, drag to reframe, then round-trip through Graphics
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.click('.fi-thumb >> nth=0')
  await page.waitForSelector('.fi-canvas', { timeout: 15000 })
  await page.waitForTimeout(600)
  const box = await page.locator('.fi-canvas').boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 - 60, box.y + box.height / 2, { steps: 6 }); await page.mouse.up()
  await page.locator('.fi-canvas').scrollIntoViewIfNeeded()
  await page.screenshot({ path: path.join(out, `${label}-image-1600.png`) })
  await page.click('button:has-text("Edit in Graphics")')
  await page.waitForSelector('.stage-canvas')
  await page.waitForTimeout(500)
  await page.screenshot({ path: path.join(out, `${label}-graphics-photos-1600.png`) })
  await page.click('.back-to-desk')
  await page.waitForSelector('.ed-card')
  for (const t of ['SEO', 'Preview']) {
    await page.click(`.ed-story-tabs button:has-text("${t}")`)
    await page.waitForTimeout(800)
    await page.screenshot({ path: path.join(out, `${label}-story-${t.toLowerCase()}-1600.png`) })
  }
  await page.click('.ed-story-tabs button:has-text("Body")')
  await page.evaluate(() => document.querySelector('.ed-side').scrollTo(0, 99999))
  for (const t of ['Banner', 'Web article', 'Facebook']) {
    await page.click(`.ed-outputs-tabs button:has-text("${t}")`)
    await page.waitForTimeout(800)
    await page.evaluate(() => document.querySelector('.ed-side').scrollTo(0, 99999))
    await page.screenshot({ path: path.join(out, `${label}-out-${t.split(' ')[0].toLowerCase()}-1600.png`) })
  }
  await page.setViewportSize({ width: 1100, height: 720 })
  await page.waitForTimeout(400)
  const metrics = await page.evaluate(() => {
    const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)] }
    return { doc: [document.documentElement.scrollWidth, innerWidth], ws: r('.editorial-workspace'), src: r('.ed-src'), main: r('.ed-center'), side: r('.ed-side') }
  })
  console.log(JSON.stringify(metrics))
} finally {
  await browser?.close()
  vite.kill()
}
