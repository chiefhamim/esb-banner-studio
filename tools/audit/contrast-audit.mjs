// Automated WCAG 2.2 AA Contrast Audit for ESB Studio across both light and dark themes.
import { chromium } from 'playwright-core'
import { launchBrowser } from '../launch-browser.mjs'
import { spawn } from 'node:child_process'
import path from 'node:path'

const PORT = 5192
const root = path.resolve(import.meta.dirname, '../..')
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

// Luminance calculation per WCAG 2.1
function parseRgb(colorStr, baseBg = [255, 255, 255]) {
  if (!colorStr) return baseBg
  const srgbMatch = colorStr.match(/color\(srgb\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)(?:\s*\/\s*([0-9.]+))?\)/)
  if (srgbMatch) {
    const r = Math.round(parseFloat(srgbMatch[1]) * 255)
    const g = Math.round(parseFloat(srgbMatch[2]) * 255)
    const b = Math.round(parseFloat(srgbMatch[3]) * 255)
    const a = srgbMatch[4] !== undefined ? parseFloat(srgbMatch[4]) : 1
    if (a < 1) {
      return [
        Math.round(r * a + baseBg[0] * (1 - a)),
        Math.round(g * a + baseBg[1] * (1 - a)),
        Math.round(b * a + baseBg[2] * (1 - a)),
      ]
    }
    return [r, g, b]
  }
  const m = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([0-9.]+))?\)/)
  if (m) {
    const r = parseInt(m[1], 10)
    const g = parseInt(m[2], 10)
    const b = parseInt(m[3], 10)
    const a = m[4] !== undefined ? parseFloat(m[4]) : 1
    if (a < 1) {
      return [
        Math.round(r * a + baseBg[0] * (1 - a)),
        Math.round(g * a + baseBg[1] * (1 - a)),
        Math.round(b * a + baseBg[2] * (1 - a)),
      ]
    }
    return [r, g, b]
  }
  return baseBg
}

function sRgbToLinear(c) {
  const v = c / 255
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

function relativeLuminance([r, g, b]) {
  return 0.2126 * sRgbToLinear(r) + 0.7152 * sRgbToLinear(g) + 0.0722 * sRgbToLinear(b)
}

function contrastRatio(rgb1, rgb2) {
  const l1 = relativeLuminance(rgb1)
  const l2 = relativeLuminance(rgb2)
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

let browser
let totalDefects = 0

try {
  await waitUp()
  browser = await launchBrowser(chromium)
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } })
  page.setDefaultTimeout(8000)

  for (const theme of ['light', 'dark']) {
    await page.goto(`http://localhost:${PORT}/`)
    await page.waitForSelector('.topbar')
    await page.evaluate((t) => {
      document.documentElement.dataset.theme = t
      window.__store?.getState().setTheme(t)
    }, theme)
    await page.waitForTimeout(400)

    const results = await page.evaluate(() => {
      function getEffectiveBg(el) {
        let cur = el
        while (cur && cur !== document.documentElement) {
          const style = getComputedStyle(cur)
          const bg = style.backgroundColor
          if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
            return bg
          }
          cur = cur.parentElement
        }
        return document.documentElement.dataset.theme === 'dark' ? 'rgb(13, 13, 15)' : 'rgb(246, 246, 247)'
      }

      const checks = []
      const candidates = document.querySelectorAll('.app *, .workspace-rail *, .home-workspace *, .editorial-workspace *')
      for (const el of candidates) {
        if (!el.textContent?.trim() || el.children.length > 2 || el.closest('.stage-overlay, .ruler, .canvas-body-slot')) continue
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue

        const style = getComputedStyle(el)
        if (style.visibility === 'hidden' || style.display === 'none' || parseFloat(style.opacity) < 0.1) continue

        const text = el.textContent.trim().slice(0, 30)
        const fg = style.color
        const bg = getEffectiveBg(el)
        checks.push({ text, fg, bg, tag: el.tagName.toLowerCase(), cls: el.className })
      }
      return checks
    })

    console.log(`\n--- Theme: ${theme.toUpperCase()} (${results.length} text elements inspected) ---`)
    let lowContrastCount = 0

    const rootBg = theme === 'dark' ? [13, 13, 15] : [233, 233, 235]
    for (const item of results) {
      const bgRgb = parseRgb(item.bg, rootBg)
      const fgRgb = parseRgb(item.fg, bgRgb)
      const ratio = contrastRatio(fgRgb, bgRgb)

      // Minimum 4.5:1 for standard body text
      if (ratio < 4.5) {
        lowContrastCount++
        if (lowContrastCount <= 5) {
          console.warn(`[Low Contrast ${ratio.toFixed(2)}:1] <${item.tag} class="${item.cls}"> "${item.text}" FG:${item.fg} BG:${item.bg}`)
        }
      }
    }

    if (lowContrastCount === 0) {
      console.log(`PASS: All elements in ${theme} theme meet WCAG 2.2 AA (>= 4.5:1)`)
    } else {
      console.log(`NOTE: ${lowContrastCount} elements have contrast < 4.5:1 in ${theme} theme.`)
      totalDefects += lowContrastCount
    }
  }

  await browser.close()
} catch (err) {
  console.error('Contrast audit error:', err)
  process.exit(1)
} finally {
  vite.kill()
}
