import { chromium } from 'playwright-core'
import { launchBrowser } from '../launch-browser.mjs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

const target = process.argv[2] || 'before'
import { portOffset } from '../port-offset.mjs'
const PORT = 5193 + portOffset()
const root = path.resolve(import.meta.dirname, '../..')
const desktopDir = path.join('C:\\Users\\hamim\\Desktop\\visual-excellence-suite', target)
fs.mkdirSync(desktopDir, { recursive: true })

console.log(`[Capture Suite] Starting capture run for target: ${target}`)
console.log(`[Capture Suite] Output directory: ${desktopDir}`)

const vite = spawn(
  process.execPath,
  [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'],
  { cwd: root, stdio: 'ignore' }
)

// Wait for Vite server
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(`http://localhost:${PORT}/`)).ok) break
  } catch {}
  await new Promise((r) => setTimeout(r, 500))
}

const csvPath = path.join(root, 'tools', 'fixtures', 'synthetic-contacts.csv')
if (!fs.existsSync(csvPath)) {
  const { writeSyntheticList } = await import('../fixtures/outreach-synthetic.mjs')
  writeSyntheticList(path.join(root, 'tools', 'fixtures'))
}
const csvBuffer = fs.readFileSync(csvPath)
const fixturePhoto = path.join(root, 'tools', 'fixtures', 'media', 'synthetic-rig.jpg')

let browser
try {
  browser = await launchBrowser(chromium)

  for (const theme of ['dark', 'light']) {
    console.log(`\n=== Capturing theme: ${theme} ===`)
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 }, acceptDownloads: true })
    const page = await ctx.newPage()
    page.setDefaultTimeout(10000)

    // Route fixture photos
    await ctx.route('**/media/**', (r) => r.fulfill({ path: fixturePhoto, contentType: 'image/jpeg' }))

    // Deterministic translation dictionary
    await page.addInitScript(() => {
      const dict = {
        '৫৯২ কোটি টাকায় দুটি নতুন কূপ খনন করবে পেট্রোবাংলা, জাতীয় গ্রিডে যুক্ত হবে ৩০ এমএমসিএফডি গ্যাস':
          'Petrobangla to drill two new wells for Tk 592 crore, adding 30 MMCFD gas to the national grid',
        'সিলেট গ্যাস ফিল্ডের আওতায় দুটি নতুন উন্নয়ন কূপ খননের উদ্যোগ নিয়েছে পেট্রোবাংলা ও বাপেক্স।':
          'Petrobangla and BAPEX have taken the initiative to drill two new development wells under the Sylhet gas field.',
        'প্রকল্পটিতে মোট ৫৯২ কোটি টাকা ব্যয় ধরা হয়েছে এবং ২০২৬ সালের মধ্যে দৈনিক ৩০ এমএমসিএফডি গ্যাস জাতীয় গ্রিডে সরবরাহ করা হবে।':
          'The project is estimated to cost a total of Tk 592 crore and will supply 30 MMCFD of gas per day to the national grid by 2026.',
      }
      window.__customTranslator = async (text) => dict[text.trim()] ?? text.replace(/[\u0980-\u09FF]+/g, 'translated')
      try {
        if (!localStorage.getItem('esb-banner-studio/dock-tab')) {
          localStorage.setItem('esb-banner-studio/dock-tab', 'layers')
        }
      } catch {}
    })

    const save = async (name) => {
      const fileName = `${name}-${theme}.png`
      const dest = path.join(desktopDir, fileName)
      await page.screenshot({ path: dest })
      console.log(`  ✓ Saved: ${fileName}`)
    }

    // 1. Home Launcher
    await page.goto(`http://localhost:${PORT}/`)
    await page.waitForSelector('.studio-shell')
    await page.evaluate((th) => {
      window.__store?.getState().setTheme(th)
      document.documentElement.setAttribute('data-theme', th)
    }, theme)
    await page.waitForTimeout(500)
    await save('01-home-launcher')

    // 2. Home Settings popover
    try {
      const gear = page.locator('.home-head-btn[aria-label="Settings"]')
      if (await gear.count()) {
        await gear.first().click()
        await page.waitForSelector('.dialog', { timeout: 3000 })
        await page.waitForTimeout(300)
        await save('02-home-settings')
        await page.keyboard.press('Escape')
        await page.waitForTimeout(200)
      }
    } catch (e) {
      console.log('  (Skipped home-settings:', e.message, ')')
    }

    // 3. Graphics Studio Canvas
    const gfxTile = page.locator('.launch-tile:has-text("Graphics")')
    if (await gfxTile.count()) {
      await gfxTile.click()
    } else {
      await page.click('.ws-btn[data-ws="graphics"]')
    }
    await page.waitForSelector('.app')
    await page.waitForTimeout(600)
    await save('03-graphics-canvas')

    // 4. Graphics Category Picker
    try {
      const catHdr = page.locator('.pnl:has-text("Category") > header, [data-panel="Category"] > header')
      if (await catHdr.count()) {
        await catHdr.first().click()
        await page.waitForTimeout(400)
        await save('04-graphics-category-picker')
      }
    } catch (e) {
      console.log('  (Skipped category picker:', e.message, ')')
    }

    // 5. Graphics Export Dialog
    try {
      const expBtn = page.locator('button.btn.primary:has-text("Export")')
      if (await expBtn.count()) {
        await expBtn.click()
        await page.waitForSelector('.dialog', { timeout: 3000 }).catch(() => {})
        await page.waitForTimeout(400)
        await save('05-graphics-export-dialog')
        await page.keyboard.press('Escape')
        await page.waitForTimeout(200)
      }
    } catch (e) {
      console.log('  (Skipped export dialog:', e.message, ')')
    }

    // 6. Editorial Intake
    await page.click('.ws-btn[data-ws="editorial"]')
    await page.waitForSelector('.editorial-workspace')
    await page.waitForTimeout(400)
    await save('06-editorial-intake')

    // 7. Editorial Story Desk
    try {
      const pasteArea = page.locator('.ed-paste-area')
      if (!(await pasteArea.count())) {
        const pasteBtn = page.locator('button:has-text("Paste Text or File")')
        if (await pasteBtn.count()) await pasteBtn.click()
      }
      const testStory = `৫৯২ কোটি টাকায় দুটি নতুন কূপ খনন করবে পেট্রোবাংলা, জাতীয় গ্রিডে যুক্ত হবে ৩০ এমএমসিএফডি গ্যাস
সিলেট গ্যাস ফিল্ডের আওতায় দুটি নতুন উন্নয়ন কূপ খননের উদ্যোগ নিয়েছে পেট্রোবাংলা ও বাপেক্স।
প্রকল্পটিতে মোট ৫৯২ কোটি টাকা ব্যয় ধরা হয়েছে এবং ২০২৬ সালের মধ্যে দৈনিক ৩০ এমএমসিএফডি গ্যাস জাতীয় গ্রিডে সরবরাহ করা হবে।`
      await page.fill('.ed-paste-area', testStory)
      await page.click('button:has-text("Process Story")')
      await page.waitForSelector('.ed-card-story', { timeout: 15000 }).catch(() => {})
      await page.waitForTimeout(600)
      await save('07-editorial-story-desk')
    } catch (e) {
      console.log('  (Skipped editorial story desk:', e.message, ')')
    }

    // 8. Editorial SEO Panel
    try {
      const seoTab = page.locator('.seg-btn:has-text("SEO"), button:has-text("SEO")')
      if (await seoTab.count()) {
        await seoTab.first().click()
        await page.waitForTimeout(400)
        await save('08-editorial-seo-panel')
        // Switch back to Body
        const bodyTab = page.locator('.seg-btn:has-text("Body"), button:has-text("Body")')
        if (await bodyTab.count()) await bodyTab.first().click()
        await page.waitForTimeout(200)
      }
    } catch (e) {
      console.log('  (Skipped SEO panel:', e.message, ')')
    }

    // 9. Editorial Publish Dialog
    try {
      const pubBtn = page.locator('button.es-publish')
      if (await pubBtn.count()) {
        await pubBtn.click()
        await page.waitForSelector('.dialog, .publish-dialog, .ed-sheet', { timeout: 5000 }).catch(() => {})
        await page.waitForTimeout(500)
        await save('09-editorial-publish-dialog')
        await page.keyboard.press('Escape')
        await page.waitForTimeout(200)
      }
    } catch (e) {
      console.log('  (Skipped publish dialog:', e.message, ')')
    }

    // 10. Video Studio Timeline
    await page.click('.ws-btn[data-ws="video"]')
    await page.waitForSelector('.video-workspace')
    await page.waitForTimeout(600)
    await save('10-video-studio-timeline')

    // 11. Outreach Campaign Composer
    await page.click('.ws-btn[data-ws="outreach"]')
    await page.waitForSelector('.outreach-workspace')
    await page.waitForTimeout(400)

    // Import contacts
    try {
      const fileInputs = page.locator('input[type=file][accept*=".xlsx"]')
      if (await fileInputs.count()) {
        await fileInputs.first().setInputFiles({
          name: 'synthetic-contacts.csv',
          mimeType: 'text/csv',
          buffer: csvBuffer,
        })
        await page.waitForTimeout(800)
      }
    } catch (e) {
      console.log('  (Skipped file input:', e.message, ')')
    }
    await save('11-outreach-campaign-composer')

    // 12. Outreach Email Preview
    try {
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('.seg-ctl button')].find((b) => /preview/i.test(b.textContent || ''))
        btn?.click()
      })
      await page.waitForTimeout(400)
      await save('12-outreach-email-preview')

      // Switch back to edit
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('.seg-ctl button')].find((b) => /edit/i.test(b.textContent || ''))
        btn?.click()
      })
      await page.waitForTimeout(200)
    } catch (e) {
      console.log('  (Skipped email preview:', e.message, ')')
    }

    // 13. Outreach Activity Desk
    try {
      await page.evaluate(() => {
        const btn = document.querySelector('.topbar button[data-tip*="Activity"]') ||
                    [...document.querySelectorAll('.seg-ctl button')].find((b) => /activity/i.test(b.textContent || ''))
        btn?.click()
      })
      await page.waitForSelector('.activity-desk, .or-activity-desk', { timeout: 4000 }).catch(() => {})
      await page.waitForTimeout(500)
      await save('13-outreach-activity-desk')

      // Close Activity desk
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('.seg-ctl button')].find((b) => /compose/i.test(b.textContent || ''))
        btn?.click()
      })
      await page.waitForTimeout(300)
    } catch (e) {
      console.log('  (Skipped activity desk:', e.message, ')')
    }

    // 14. Outreach Assistant Dialog
    try {
      await page.evaluate(() => {
        const items = [...document.querySelectorAll('.topbar .mb-item')]
        const view = items.find((el) => /View/i.test(el.textContent || ''))
        view?.click()
      })
      await page.waitForTimeout(200)
      await page.evaluate(() => {
        const items = [...document.querySelectorAll('.menu-item')]
        const ast = items.find((el) => /Ask the assistant/i.test(el.textContent || ''))
        ast?.click()
      })
      await page.waitForSelector('.dialog, .ed-sheet', { timeout: 3000 }).catch(() => {})
      await page.waitForTimeout(400)
      await save('14-outreach-assistant-dialog')
      await page.keyboard.press('Escape')
      await page.waitForTimeout(200)
    } catch (e) {
      console.log('  (Skipped assistant dialog:', e.message, ')')
    }

    // 15. Footer Engine Status Popover
    try {
      const engBtn = page.locator('button.sb-engine-btn')
      if (await engBtn.count()) {
        await engBtn.click()
        await page.waitForSelector('.eng-pop', { timeout: 3000 }).catch(() => {})
        await page.waitForTimeout(400)
        await save('15-footer-engine-status')
        await page.keyboard.press('Escape')
        await page.waitForTimeout(200)
      }
    } catch (e) {
      console.log('  (Skipped engine status:', e.message, ')')
    }

    await ctx.close()
  }

  console.log(`\n[Capture Suite] All screenshots captured successfully for target: ${target}!`)
} finally {
  await browser?.close()
  vite.kill()
}
