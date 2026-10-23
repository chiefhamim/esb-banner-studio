// End-to-end Playwright test of the Editorial Desk & Fact Verification engine.
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { launchBrowser } from './launch-browser.mjs'

const PORT = 5194
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
let failed = 0

function check(name, ok, extra = '') {
  if (ok) {
    console.log('PASS', name, extra)
  } else {
    console.log('FAIL', name, extra)
    failed++
  }
}

try {
  await waitUp()
  browser = await launchBrowser(chromium)
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } })
  page.setDefaultTimeout(8000)

  await page.goto(`http://localhost:${PORT}/`)
  await page.waitForSelector('.studio-shell')

  // 1. Switch to Editorial Desk via Workspace Rail
  await page.click('.rail-btn:has-text("Editorial")')
  await page.waitForSelector('.editorial-workspace')
  check('Editorial Desk workspace opened', (await page.locator('.ed-topbar-title').textContent()).includes('Editorial Desk'))

  // 2. Verify connection telemetry and live posts list
  await page.waitForSelector('.ed-site-pill')
  check('Live site connection telemetry pill displayed', (await page.locator('.ed-site-pill').count()) === 1)

  // 3. Select Paste Bengali Story mode and enter Bengali story text
  await page.click('button:has-text("Paste Bengali Story")')
  await page.waitForSelector('.ed-paste-area')
  const testStory = `৫৯২ কোটি টাকায় দুটি নতুন কূপ খনন করবে পেট্রোবাংলা, জাতীয় গ্রিডে যুক্ত হবে ৩০ এমএমসিএফডি গ্যাস
সিলেট গ্যাস ফিল্ডের আওতায় দুটি নতুন উন্নয়ন কূপ খননের উদ্যোগ নিয়েছে পেট্রোবাংলা ও বাপেক্স।
প্রকল্পটিতে মোট ৫৯২ কোটি টাকা ব্যয় ধরা হয়েছে এবং ২০২৬ সালের মধ্যে দৈনিক ৩০ এমএমসিএফডি গ্যাস জাতীয় গ্রিডে সরবরাহ করা হবে।`

  await page.fill('.ed-paste-area', testStory)
  await page.click('button:has-text("Auto-Translate & Populate")')

  // 4. Verify Left Column keeps Original Bengali and Right Column populates English Translation
  await page.waitForSelector('#source-title-input')
  const sourceTitleVal = await page.inputValue('#source-title-input')
  check('Left column preserves original Bengali headline', /[\u0980-\u09FF]/.test(sourceTitleVal))

  // Generous timeout: translation races two remote services with a short internal
  // budget each, but a slow/blocked network path (e.g. sandboxed proxy tunnels) can
  // still take several seconds to fail before the offline fallback kicks in.
  await page.waitForFunction(() => {
    const el = document.querySelector('#draft-headline')
    return el && el.value.trim().length > 0 && !/[\u0980-\u09FF]/.test(el.value)
  }, { timeout: 20000 })
  const headlineVal = await page.inputValue('#draft-headline')
  const bodyVal = await page.inputValue('#draft-body')
  check('Draft headline populated in English (no Bengali overwrite)', headlineVal.length > 0 && !/[\u0980-\u09FF]/.test(headlineVal))
  check('Draft body populated in English', bodyVal.length > 0 && !/[\u0980-\u09FF]/.test(bodyVal))

  // 5. Test Trucent headline line breaker
  const trucentWords = await page.locator('.ed-trucent-word-item').count()
  check('Trucent interactive word strip rendered', trucentWords > 0)

  // 6. Test Send Headline to Banner
  await page.fill('#draft-headline', 'Official: Two New Wells to Add 30 MMCFD Gas to Grid for Tk 592 Crore')
  await page.click('button:has-text("Send to Banner")')

  // Asserts switch to Graphics workspace
  await page.click('button:has-text("Graphics Studio")')
  await page.waitForSelector('.stage-canvas')
  check('Switched to Graphics workspace', (await page.locator('.stage-canvas').count()) === 1)

  // Verify headline in banner store
  const storeHeadline = await page.evaluate(() => window.__store.getState().doc.content.headline)
  check('Banner headline updated from Editorial Draft', storeHeadline.includes('Official: Two New Wells to Add 30 MMCFD Gas to Grid for Tk 592 Crore'))

  // 7. Return to Editorial Desk and test Live Preview replicas
  await page.click('.rail-btn:has-text("Editorial")')
  await page.waitForSelector('.editorial-workspace')

  // Test Web Article Replica
  await page.click('button:has-text("Web Article")')
  await page.waitForSelector('.esb-site-mock')
  check('Official esbpowerline.com website replica rendered', (await page.locator('.esb-site-mock').count()) === 1)

  // Test Facebook Mock
  await page.click('button:has-text("Facebook")')
  await page.waitForSelector('.fb')
  check('Facebook feed replica rendered', (await page.locator('.fb').count()) === 1)


  // 8. Graphics rail + live link
  await page.waitForSelector('.ed-rail')
  check('Graphics rail shows the live banner', (await page.locator('.ed-rail canvas').count()) === 1)
  await page.fill('#draft-headline', 'Live link headline test')
  await page.waitForTimeout(250)
  check('Typing the headline updates the banner live', (await page.evaluate(() => window.__store.getState().doc.content.headline)) === 'Live link headline test')
  await page.evaluate(() => window.__store.getState().setContent({ headline: 'Edited from Graphics' }))
  await page.waitForTimeout(250)
  check('Editing the banner updates the draft headline', (await page.inputValue('#draft-headline')) === 'Edited from Graphics')
  await page.click('.ed-rail-desk:has-text("07")')
  await page.click('button:has-text("Send to Banner")')
  check('A hand-picked desk survives Send to Banner', (await page.evaluate(() => window.__store.getState().doc.content.categoryId)) === '07')

  // 9. Publish pre-flight gates the live publish
  await page.click('button:has-text("Publish")')
  await page.waitForSelector('.ed-preflight')
  check('Publish Live is blocked until the checklist is ticked', await page.locator('button:has-text("Publish Live to CMS")').isDisabled())

  await browser.close()
} catch (err) {
  console.error('Test error:', err)
  failed++
} finally {
  vite.kill()
  process.exit(failed > 0 ? 1 : 0)
}
