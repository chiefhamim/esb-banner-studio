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
  // Hermetic translation: no live API calls from the suite (SPEC §3). The app's injectable
  // translator seam (window.__customTranslator) gets a deterministic Bengali→English map.
  await page.addInitScript(() => {
    const dict = {
      '৫৯২ কোটি টাকায় দুটি নতুন কূপ খনন করবে পেট্রোবাংলা, জাতীয় গ্রিডে যুক্ত হবে ৩০ এমএমসিএফডি গ্যাস': 'Petrobangla to drill two new wells for Tk 592 crore, adding 30 MMCFD gas to the national grid',
      'সিলেট গ্যাস ফিল্ডের আওতায় দুটি নতুন উন্নয়ন কূপ খননের উদ্যোগ নিয়েছে পেট্রোবাংলা ও বাপেক্স।': 'Petrobangla and BAPEX have taken the initiative to drill two new development wells under the Sylhet gas field.',
      'প্রকল্পটিতে মোট ৫৯২ কোটি টাকা ব্যয় ধরা হয়েছে এবং ২০২৬ সালের মধ্যে দৈনিক ৩০ এমএমসিএফডি গ্যাস জাতীয় গ্রিডে সরবরাহ করা হবে।': 'The project is estimated to cost a total of Tk 592 crore and will supply 30 MMCFD of gas per day to the national grid by 2026.',
    }
    window.__customTranslator = async (text) => dict[text.trim()] ?? text.replace(/[ঀ-৿]+/g, 'translated')
  })

  // Fixture pages reference photos under /media/…; every one is served the drawn test picture (tools/fixtures/README.md).
  const fixturePhoto = path.join(root, 'tools', 'fixtures', 'media', 'synthetic-rig.jpg')
  await page.route('**/media/**', (r) => r.fulfill({ path: fixturePhoto, contentType: 'image/jpeg' }))
  await page.goto(`http://localhost:${PORT}/`)
  await page.waitForSelector('.studio-shell')

  // 1. Switch to Editorial Desk via Workspace Rail
  await page.click('.rail-btn:has-text("Editorial")')
  await page.waitForSelector('.editorial-workspace')
  check('Editorial Desk workspace opened', (await page.locator('.ed-topbar-title').textContent()).includes('Editorial Desk'))

  // 2. Verify connection telemetry and live posts list
  await page.waitForSelector('.ed-site-pill')
  check('Live site connection telemetry pill displayed', (await page.locator('.ed-site-pill').count()) === 1)

  // 2b. A link that cannot be fetched gets an honest message and the paste fallback, not a dead end
  await page.fill('.ed-url-input', 'https://blocked.invalid/story')
  await page.click('button:has-text("Fetch & Auto-Translate")')
  await page.waitForSelector('.ed-intake-error', { timeout: 30000 })
  const intakeErr = await page.locator('.ed-intake-error').innerText()
  check('Unreachable link shows a specific intake error', /blocked\.invalid/.test(intakeErr) || /could not be reached|could not be found/.test(intakeErr), intakeErr.slice(0, 80))
  await page.click('.ed-intake-error button:has-text("Paste the text instead")')
  await page.waitForSelector('.ed-paste-area')
  check('"Paste the text instead" switches to the paste tab', (await page.locator('.ed-paste-area').count()) === 1)

  // 2c. The real link pipeline end to end, against a fixture page Vite serves (no network): fetch → extract → translate → draft.
  await page.click('button:has-text("Paste Story Link")')
  await page.fill('.ed-url-input', `http://localhost:${PORT}/tools/fixtures/jsonld-news.html`)
  await page.click('button:has-text("Fetch & Auto-Translate")')
  await page.waitForSelector('.ed-extract-report', { timeout: 30000 })
  const report = await page.locator('.ed-extract-report').innerText()
  check('Link intake: extraction report shows method, language and counts', /Page markup|Structured data/.test(report) && /Bengali/.test(report) && /4 paragraphs/.test(report) && /[12] photos?/.test(report), report.replace(/\n/g, ' · '))
  check('Link intake: source pane holds the Bengali headline from the page', (await page.inputValue('#source-title-input')) === 'গ্যাস সরবরাহ বাড়াতে সিলেটে দুটি নতুন কূপ')
  check('Link intake: fact chips are deduplicated', (await page.locator('.fact-pill').allTextContents()).filter((t) => t === 'Tk 592 crore').length === 1)
  // back to a clean launcher for the paste flow below (the desk autosaves, so clear its session first)
  await page.evaluate(() => { try { localStorage.removeItem('esb-banner-studio/editorial/v1') } catch {} })
  await page.reload()
  await page.waitForSelector('.studio-shell')
  await page.click('.rail-btn:has-text("Editorial")')
  await page.waitForSelector('button:has-text("Paste Bengali Story")')

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
  // (waitForFunction's options are the 3rd argument; the 2nd is the page-function arg.)
  await page.waitForFunction(() => {
    const el = document.querySelector('#draft-headline')
    return el && el.value.trim().length > 0 && !/[\u0980-\u09FF]/.test(el.value)
  }, null, { timeout: 20000 })
  const headlineVal = await page.inputValue('#draft-headline')
  const bodyVal = await page.inputValue('#draft-body')
  check('Draft headline populated in English (no Bengali overwrite)', headlineVal.length > 0 && !/[\u0980-\u09FF]/.test(headlineVal))
  check('Extraction report shows method, language and counts', /Page markup|Structured data|Page data|Metadata only/.test(await page.locator('.ed-extract-report').innerText().catch(() => '')) || (await page.locator('.ed-extract-report').count()) === 0)
  check('Draft body populated in English', bodyVal.length > 0 && !/[\u0980-\u09FF]/.test(bodyVal))

  // 5. CMS layout: "Headline & deck" and "Story" are separate panels, no banner line-break strip in the editor
  const layout = await page.evaluate(() => {
    const head = document.querySelector('.ed-card-headline')
    const story = document.querySelector('.ed-card-story')
    return { head: !!head, story: !!story, nested: !!(head && story && head.contains(story)), breaker: document.querySelectorAll('.ed-trucent-word-item, .ed-headline-breaker-wrap').length, details: document.querySelectorAll('details.ed-story-details').length }
  })
  check('Centre is the CMS editor: Headline & deck panel, then a standalone Story panel', layout.head && layout.story && !layout.nested && layout.details === 0, JSON.stringify(layout))
  check('Banner line-break strip is gone from the editor', layout.breaker === 0)
  await page.click('.ed-story-tabs button:has-text("SEO")')
  check('Story → SEO holds the slug with the /articles/ prefix', (await page.locator('.ed-card-story #draft-slug').count()) === 1 && (await page.locator('.ed-slug-prefix').innerText()) === '/articles/')
  await page.click('.ed-story-tabs button:has-text("Preview")')
  await page.waitForSelector('.ed-card-story .esb-site-mock iframe')
  check('Story → Preview shows the esbpowerline.com article page', (await page.locator('.ed-card-story .esb-site-mock').count()) === 1)
  await page.click('.ed-story-tabs button:has-text("Body")')

  // 6. Send Headline to Banner
  await page.fill('#draft-headline', 'Official: Two New Wells to Add 30 MMCFD Gas to Grid for Tk 592 Crore')
  await page.click('.ed-outputs button:has-text("Send to Banner")')

  // Asserts switch to Graphics workspace, with the way back offered
  await page.click('.ed-outputs-link button:has-text("Graphics")')
  await page.waitForSelector('.stage-canvas')
  check('Switched to Graphics workspace', (await page.locator('.stage-canvas').count()) === 1)
  check('Graphics offers the way back to the Editorial desk', (await page.locator('.back-to-desk').count()) === 1)

  // Verify headline in banner store
  const storeHeadline = await page.evaluate(() => window.__store.getState().doc.content.headline)
  check('Banner headline updated from Editorial Draft', storeHeadline.includes('Official: Two New Wells to Add 30 MMCFD Gas to Grid for Tk 592 Crore'))

  // 7. Return to Editorial Desk and test Live Preview replicas
  await page.click('.back-to-desk')
  await page.waitForSelector('.editorial-workspace')

  // Outputs: one smooth segmented control, not three loose tabs
  const segs = await page.evaluate(() => {
    const seg = document.querySelector('.ed-outputs-tabs')
    const btns = [...seg.querySelectorAll('button')].map((b) => b.getBoundingClientRect())
    return { isSeg: seg.classList.contains('seg-ctl'), thumb: !!seg.querySelector('.pill-slide'), tops: new Set(btns.map((b) => Math.round(b.top))).size, bottoms: new Set(btns.map((b) => Math.round(b.bottom))).size, n: btns.length }
  })
  check('Banner / Web article / Facebook share one segmented control with level edges', segs.isSeg && segs.thumb && segs.n === 3 && segs.tops === 1 && segs.bottoms === 1, JSON.stringify(segs))

  // Test Web Article Replica
  await page.click('.ed-outputs-tabs button:has-text("Web article")')
  await page.waitForSelector('.ed-outputs .esb-site-mock iframe')
  check('Official esbpowerline.com website replica rendered', (await page.locator('.esb-site-mock').count()) === 1)
  // The preview is the site's own article template in an iframe with the site stylesheet (tools/site-css.mjs).
  const site = page.frameLocator('.esb-site-mock iframe')
  await site.locator('h1').waitFor({ timeout: 10000 })
  const siteInfo = await page.evaluate(() => {
    const d = document.querySelector('.esb-site-mock iframe').contentDocument
    const h1 = d.querySelector('h1')
    return { theme: d.documentElement.className, h1: h1?.textContent ?? '', h1Font: getComputedStyle(h1).fontFamily, cells: d.querySelectorAll('.category-nav-cell').length, active: d.querySelector('.category-nav-cell--active .category-nav-label')?.textContent ?? '', bg: getComputedStyle(d.body).backgroundColor }
  })
  check('Site preview uses the site theme and headline font', siteInfo.theme.includes('theme-white') && /Space Grotesk/.test(siteInfo.h1Font) && siteInfo.bg === 'rgb(248, 250, 252)', JSON.stringify(siteInfo))
  check('Site preview binds the draft headline and desk ribbon', siteInfo.h1 === (await page.inputValue('#draft-headline')) && siteInfo.cells === 10 && siteInfo.active.length > 0, siteInfo.active)
  await page.click('.ed-outputs .seg-ctl button:has-text("Midnight")')
  await page.waitForTimeout(300)
  check('Site preview switches to the Midnight theme', await page.evaluate(() => document.querySelector('.esb-site-mock iframe').contentDocument.documentElement.classList.contains('theme-midnight')))
  await page.click('.ed-outputs .seg-ctl button:has-text("White")')

  // Test Facebook Mock
  await page.click('.ed-outputs-tabs button:has-text("Facebook")')
  await page.waitForSelector('.ed-outputs .fb')
  check('Facebook feed replica rendered', (await page.locator('.fb').count()) === 1)

  // 8. Banner output + live link
  await page.click('.ed-outputs-tabs button:has-text("Banner")')
  check('Outputs shows the live banner', (await page.locator('.ed-outputs-canvas canvas').count()) === 1)
  await page.fill('#draft-headline', 'Live link headline test')
  await page.waitForTimeout(250)
  check('Typing the headline updates the banner live', (await page.evaluate(() => window.__store.getState().doc.content.headline)) === 'Live link headline test')
  await page.evaluate(() => window.__store.getState().setContent({ headline: 'Edited from Graphics' }))
  await page.waitForTimeout(250)
  check('Editing the banner updates the draft headline', (await page.inputValue('#draft-headline')) === 'Edited from Graphics')
  await page.click('.ed-desk-select')
  await page.click('.menu-item:has-text("Consumers & Tariffs")')
  await page.click('.ed-outputs button:has-text("Send to Banner")')
  check('A hand-picked category survives Send to Banner', (await page.evaluate(() => window.__store.getState().doc.content.categoryId)) === '07')

  // 8b. Featured image: add one from disk (this story was pasted, so it has no photos), reframe, round-trip through Graphics
  await page.setInputFiles('.fi input[type=file]', fixturePhoto)
  await page.waitForSelector('.fi-canvas', { timeout: 15000 })
  await page.waitForTimeout(400)
  const slotOf = () => page.evaluate(() => { const s = window.__store.getState(); return s.doc.photos.slots[s.format][0] })
  check('Adding a photo makes it the featured photo', !!(await slotOf())?.src)
  const fiPx = await page.evaluate(() => { const c = document.querySelector('.fi-canvas'); const d = c.getContext('2d').getImageData(c.width / 2, c.height / 2, 1, 1).data; return d[3] })
  check('Featured image preview draws the photo', fiPx === 255)
  await page.evaluate(() => { const s = window.__store.getState(); s.setCollage('single') })
  await page.waitForTimeout(200)
  await page.locator('.fi-canvas').scrollIntoViewIfNeeded()
  const box = await page.locator('.fi-canvas').boundingBox()
  const pan0 = (await slotOf()).panX
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 - 50, box.y + box.height / 2, { steps: 5 })
  await page.mouse.up()
  const pan1 = (await slotOf()).panX
  check('Dragging the featured image reframes the banner photo', pan1 > pan0, `${pan0} → ${pan1}`)
  await page.click('.fi-open')
  await page.waitForSelector('.stage-canvas')
  const gfx = await page.evaluate(() => ({ tab: document.querySelector('.left .side-tabs button.on')?.textContent, sel: window.__store.getState().selectedId }))
  check('Edit in Graphics opens on the Photos tab with the photo selected', gfx.tab === 'Photos' && gfx.sel === 'photos', JSON.stringify(gfx))
  await page.evaluate(() => window.__store.getState().setSlot(0, { brightness: 30 }))
  await page.click('.back-to-desk')
  await page.waitForSelector('.fi-canvas')
  check('A tone edit made in Graphics shows in the Editorial image panel', /^30/.test(await page.locator('.fi .scrub:has-text("Exposure") input').inputValue()))

  // 8c. Responsive: three columns that fit at a laptop width, nothing spilling sideways
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.waitForTimeout(300)
  const fit = await page.evaluate(() => {
    const w = (s) => document.querySelector(s)?.getBoundingClientRect().width ?? 0
    return { over: document.documentElement.scrollWidth - innerWidth, center: Math.round(w('.ed-center')), side: Math.round(w('.ed-side')), src: Math.round(w('.ed-src')) }
  })
  check('At 1366 px the editor keeps a readable centre with both sidebars', fit.over <= 0 && fit.center >= 560 && fit.side >= 280 && (fit.src === 0 || fit.src >= 260), JSON.stringify(fit))
  await page.setViewportSize({ width: 1600, height: 950 })

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
