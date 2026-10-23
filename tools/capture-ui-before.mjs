// Capture before-screenshots of all workspaces and key states at 1366 and 1920, light + dark, DPR 1 & 1.5
import { chromium } from 'playwright-core'
import { launchBrowser } from './launch-browser.mjs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

const PORT = 5193
const root = path.resolve(import.meta.dirname, '..')
const outDir = path.join(root, 'tools', 'out', 'ui-before')
fs.mkdirSync(outDir, { recursive: true })

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
try {
  await waitUp()
  browser = await launchBrowser(chromium)

  const viewports = [
    { name: '1366', width: 1366, height: 768 },
    { name: '1920', width: 1920, height: 1080 },
  ]
  const dprs = [1, 1.5]
  const themes = ['light', 'dark']

  for (const vp of viewports) {
    for (const dpr of dprs) {
      for (const theme of themes) {
        const ctx = await browser.newContext({
          viewport: { width: vp.width, height: vp.height },
          deviceScaleFactor: dpr,
        })
        const page = await ctx.newPage()
        await page.goto(`http://localhost:${PORT}/`)
        await page.waitForSelector('.topbar')

        // Set theme
        await page.evaluate((t) => {
          document.documentElement.dataset.theme = t
          window.__store?.getState().setTheme(t)
        }, theme)
        await page.waitForTimeout(300)

        // 1. Graphics workspace (default)
        await page.screenshot({ path: path.join(outDir, `graphics-${vp.name}-${theme}-dpr${dpr}.png`) })

        // 2. Open Export Dialog
        await page.click('header .split button:has-text("Export")')
        await page.waitForSelector('.dialog')
        await page.screenshot({ path: path.join(outDir, `graphics-export-${vp.name}-${theme}-dpr${dpr}.png`) })
        await page.keyboard.press('Escape')
        await page.waitForTimeout(200)

        // 3. Switch to Home Workspace
        await page.click('.ws-btn[data-ws="home"]')
        await page.waitForSelector('.home-workspace')
        await page.waitForTimeout(200)
        await page.screenshot({ path: path.join(outDir, `home-${vp.name}-${theme}-dpr${dpr}.png`) })

        // 4. Switch to Editorial Workspace
        await page.click('.ws-btn[data-ws="editorial"]')
        await page.waitForSelector('.editorial-workspace')
        await page.waitForTimeout(200)
        await page.screenshot({ path: path.join(outDir, `editorial-${vp.name}-${theme}-dpr${dpr}.png`) })

        await page.close()
        await ctx.close()
      }
    }
  }

  console.log('UI before screenshots successfully captured in tools/out/ui-before/')
} finally {
  await browser?.close()
  vite.kill()
}
