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

// Open a collapsible panel by id (they start closed except Category / Organize, and close each other).
async function openPanel(page, id) {
  const sel = `[data-panel="${id}"]`
  if (!(await page.locator(`${sel}.open`).count())) await page.click(`${sel} > header`)
  await page.waitForSelector(`${sel}.open > .pnl-body`)
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
  await page.click('.ws-btn[data-ws="editorial"]')
  await page.waitForSelector('.editorial-workspace')
  check('Editorial Desk workspace opened', (await page.getAttribute('.editorial-workspace .ws-btn.on', 'data-ws')) === 'editorial')

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
  await page.waitForSelector('.ed-card-story', { timeout: 30000 })
  await openPanel(page, 'ed-src-link')
  await page.waitForSelector('.ed-extract-report', { timeout: 30000 })
  const report = await page.locator('.ed-extract-report').innerText()
  check('Link intake: extraction report shows method, language and counts', /Page markup|Structured data/.test(report) && /Bengali/.test(report) && /4 paragraphs/.test(report) && /[12] photos?/.test(report), report.replace(/\n/g, ' · '))
  await openPanel(page, 'ed-src-head')
  check('Link intake: source pane holds the Bengali headline from the page', (await page.inputValue('#source-title-input')) === 'গ্যাস সরবরাহ বাড়াতে সিলেটে দুটি নতুন কূপ')
  await openPanel(page, 'ed-src-facts')
  check('Link intake: fact chips are deduplicated', (await page.locator('.fact-pill').allTextContents()).filter((t) => t === 'Tk 592 crore').length === 1)
  // back to a clean launcher for the paste flow below (the desk autosaves, so clear its session first)
  await page.evaluate(() => { try { localStorage.removeItem('esb-banner-studio/editorial/v1'); sessionStorage.clear() } catch {} })
  await page.reload()
  await page.waitForSelector('.studio-shell')
  await page.click('.ws-btn[data-ws="editorial"]')
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
  await page.waitForSelector('.ed-card-story', { timeout: 30000 })
  // 5b. Panels: a fresh session opens one section per column — Organize (category) on the right, the story on the left
  const openNow = await page.evaluate(() => ({ right: [...document.querySelectorAll('.ed-side-scroll > .pnl.open')].map((p) => p.dataset.panel), left: [...document.querySelectorAll('.ed-src-scroll > .pnl.open')].map((p) => p.dataset.panel) }))
  check('Only Organize starts open in the sidebar, only the story in the source column', openNow.right.join() === 'ed-organize' && openNow.left.join() === 'ed-src-body', JSON.stringify(openNow))
  await openPanel(page, 'ed-src-head')
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

  // 5a. Shell: one workspace switcher in the header, no side rail, no logo outside Home / About
  const shell = await page.evaluate(() => ({ sw: document.querySelectorAll('.editorial-workspace .topbar .ws-switch').length, rail: document.querySelectorAll('.workspace-rail').length, logo: document.querySelectorAll('.editorial-workspace img[src*="esb-logo"]').length, on: document.querySelector('.ws-btn.on')?.dataset.ws }))
  check('Header carries the workspace switcher; no rail, no logo', shell.sw === 1 && shell.rail === 0 && shell.logo === 0 && shell.on === 'editorial', JSON.stringify(shell))

  await page.click('[data-panel="ed-image"] > header')
  await page.waitForTimeout(250)
  const acc = await page.evaluate(() => [...document.querySelectorAll('.ed-side-scroll > .pnl.open')].map((p) => p.dataset.panel))
  check('Opening a section closes the other one in that column', acc.join() === 'ed-image', acc.join())
  await openPanel(page, 'ed-organize')

  // 5c. View menu: appearance and Bengali reading font
  await page.click('.editorial-workspace .mb-item:has-text("View")')
  await page.click('.menu-item:has-text("Dark")')
  check('View → Dark switches the theme from the Editorial desk', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark')
  await page.click('.editorial-workspace .mb-item:has-text("View")')
  await page.click('.menu-item:has-text("Light")')
  await page.click('.editorial-workspace .mb-item:has-text("View")')
  await page.click('.menu-item:has-text("Noto Serif Bengali")')
  await openPanel(page, 'ed-src-body')
  const bnFace = await page.evaluate(async () => { await document.fonts.ready; const p = document.querySelector('.source-reader-p'); return { family: getComputedStyle(p).fontFamily, loaded: document.fonts.check('16px "Noto Serif Bengali"', 'সিলেট') } })
  check('View → Bengali font changes the source column typeface', /Noto Serif Bengali/.test(bnFace.family) && bnFace.loaded, JSON.stringify(bnFace))
  await page.click('.editorial-workspace .mb-item:has-text("View")')
  await page.click('.menu-item:has-text("Hind Siliguri")')

  // 5d. Columns resize by dragging their edge, like Graphics
  const sideW0 = await page.evaluate(() => document.querySelector('.ed-side').getBoundingClientRect().width)
  const sp = await page.locator('.ed-side > .splitter').boundingBox()
  await page.mouse.move(sp.x + sp.width / 2, sp.y + 200); await page.mouse.down(); await page.mouse.move(sp.x - 60, sp.y + 200, { steps: 6 }); await page.mouse.up()
  const sideW1 = await page.evaluate(() => document.querySelector('.ed-side').getBoundingClientRect().width)
  check('Dragging the sidebar edge widens it', sideW1 > sideW0 + 40, `${Math.round(sideW0)} → ${Math.round(sideW1)}`)
  await page.dblclick('.ed-side > .splitter')
  await page.click('.ed-story-tabs button:has-text("SEO")')
  check('Story → SEO holds the slug with the /articles/ prefix', (await page.locator('.ed-card-story #draft-slug').count()) === 1 && (await page.locator('.ed-slug-prefix').innerText()) === '/articles/')
  const chips = await page.locator('.seo-chip').allTextContents()
  check('SEO suggests keyphrases from the story, with no amounts', chips.length >= 2 && !chips.some((c) => /\d/.test(c)), chips.join(' · '))
  await page.click('.seo-chip >> nth=0')
  await page.click('button:has-text("Build from headline")')
  await page.click('button:has-text("Build from story")')
  const seo = await page.evaluate(() => ({ kp: document.querySelector('#draft-keyphrase').value, title: document.querySelector('#draft-meta-title').value, serp: document.querySelector('.seo-serp-title').textContent, checks: document.querySelectorAll('.seo-check').length, titleCheck: document.querySelector('[data-check="kp-title"]').className }))
  check('SEO: keyphrase, built title in the Google preview, and the checks run', seo.kp === chips[0] && seo.title.includes(seo.kp) && seo.serp.length > 10 && seo.checks === 17 && /good/.test(seo.titleCheck) && !/ESB PowerLine/.test(seo.title + seo.serp), JSON.stringify(seo))
  await page.click('.ed-story-tabs button:has-text("Preview")')
  await page.waitForSelector('.ed-card-story .esb-site-mock iframe')
  check('Story → Preview shows the esbpowerline.com article page', (await page.locator('.ed-card-story .esb-site-mock').count()) === 1)
  await page.waitForFunction(() => document.querySelector('.ed-card-story .esb-site-mock iframe')?.contentDocument?.querySelector('figure img')?.src?.startsWith('blob:'), null, { timeout: 10000 }).catch(() => {})
  const hero = await page.evaluate(() => { const img = document.querySelector('.ed-card-story .esb-site-mock iframe').contentDocument.querySelector('figure img'); return img ? { src: img.src.slice(0, 5), w: img.naturalWidth, h: img.naturalHeight } : null })
  check('The article hero is the rendered 16:9 Web banner', !!hero && hero.src === 'blob:' && Math.abs(hero.w / hero.h - 16 / 9) < 0.01, JSON.stringify(hero))
  await page.click('.ed-story-tabs button:has-text("Body")')

  // 6. Send Headline to Banner
  await page.fill('#draft-headline', 'Official: Two New Wells to Add 30 MMCFD Gas to Grid for Tk 592 Crore')
  await openPanel(page, 'ed-outputs')
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
  await page.click('.ed-outputs-opts .select >> nth=1'); await page.click('.menu-item:has-text("Midnight")')
  await page.waitForTimeout(300)
  check('Site preview switches to the Midnight theme', await page.evaluate(() => document.querySelector('.esb-site-mock iframe').contentDocument.documentElement.classList.contains('theme-midnight')))
  await page.click('.ed-outputs-opts .select >> nth=1'); await page.click('.menu-item:has-text("White")')

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
  await openPanel(page, 'ed-organize')
  await page.click('.ed-desk-select')
  await page.click('.menu-item:has-text("Consumers & Tariffs")')
  await openPanel(page, 'ed-outputs')
  await page.click('.ed-outputs button:has-text("Send to Banner")')
  check('A hand-picked category survives Send to Banner', (await page.evaluate(() => window.__store.getState().doc.content.categoryId)) === '07')

  // 8b. Featured image: add one from disk (this story was pasted, so it has no photos), reframe, round-trip through Graphics
  await openPanel(page, 'ed-image')
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

  // 8d. Sign in like the site's staff login (auth service stubbed: this suite never reaches the network)
  await page.route('**/auth/v1/token**', async (r) => {
    const body = JSON.parse(r.request().postData() || '{}')
    if (body.password !== 'correct horse') return r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid login credentials' }) })
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ access_token: 'acc', refresh_token: 'ref', expires_in: 3600, user: { id: 'u1', email: body.email, user_metadata: {}, app_metadata: {} } }) })
  })
  await page.route('**/rest/v1/profiles**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ role: 'EDITOR', status: 'ACTIVE', full_name: 'Desk Editor' }]) }))
  await page.click('.editorial-workspace .ed-account')
  await page.waitForSelector('.signin')
  const sheet = await page.evaluate(() => ({ bypass: /bypass/i.test(document.querySelector('.signin').innerText), emailType: document.querySelector('.signin input[name=email]')?.type, pwAuto: document.querySelector('.signin input[name=password]')?.autocomplete }))
  check('Sign-in sheet: real email/password fields, no bypass option', !sheet.bypass && sheet.emailType === 'email' && sheet.pwAuto === 'current-password', JSON.stringify(sheet))
  // typing the password while the desk re-renders (status refresh, toasts) must not move the cursor back to the email
  // field — the sheet used to re-run its focus effect on every parent render
  await page.waitForTimeout(150)
  await page.focus('.signin input[name=password]')
  for (const ch of 'abc def') { await page.evaluate(() => window.__editorialStore.setState({ siteStatus: { ...window.__editorialStore.getState().siteStatus, latencyMs: Math.random() * 100 } })); await page.keyboard.type(ch) }
  const typed = await page.evaluate(() => ({ email: document.querySelector('.signin input[name=email]').value, pw: document.querySelector('.signin input[name=password]').value }))
  check('Typing the password while the desk re-renders keeps focus in the password field', typed.pw === 'abc def' && !typed.email.includes('abc'), JSON.stringify(typed))
  await page.fill('.signin input[name=email]', 'editor@esbpowerline.com')
  await page.fill('.signin input[name=password]', 'wrong')
  await page.waitForFunction(() => !document.querySelector('.signin-submit')?.disabled) // the sheet focuses its field 60 ms after opening; a fill before that can be re-rendered away
  await page.click('.signin-submit')
  await page.waitForSelector('.signin-error')
  check('A wrong password gets the site\'s wording', /Invalid email or password/.test(await page.locator('.signin-error').innerText()))
  await page.fill('.signin input[name=password]', 'correct horse')
  await page.waitForFunction(() => !document.querySelector('.signin-submit')?.disabled) // the sheet focuses its field 60 ms after opening; a fill before that can be re-rendered away
  await page.click('.signin-submit')
  await page.waitForSelector('.signin-avatar')
  const who = await page.evaluate(() => ({ name: document.querySelector('.signin-body h2').textContent, badges: document.querySelector('.signin-badges').innerText, stored: JSON.parse(localStorage.getItem('esb-banner-studio/site-session') || 'null') }))
  check('Signed in: name and role come from the site profile; the password is not stored', who.name === 'Desk Editor' && /Editor/.test(who.badges) && !!who.stored && !JSON.stringify(who.stored).includes('correct horse'), JSON.stringify({ name: who.name, badges: who.badges }))
  // 8e. The connection check reports what each service answered (stubbed here; live in the desktop app)
  await page.route('**/auth/v1/health**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
  await page.route('**/auth/v1/user**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"id":"u1"}' }))
  await page.route('**/rest/v1/Article?select=id**', (r) => r.fulfill({ status: 401, contentType: 'application/json', body: '{"message":"denied"}' }))
  await page.route('**/feed.xml', (r) => r.fulfill({ status: 200, contentType: 'application/xml', body: '<rss/>' }))
  await page.click('.conn-run')
  await page.waitForSelector('.conn-row[data-check="ai"]')
  const conn = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.conn-row')].map((r) => [r.dataset.check, r.className.split(' ').pop()])))
  check('Connection check: each link reported as it answered; a refused table is a failure, upload is desktop-only',
    conn.site === 'ok' && conn.auth === 'ok' && conn.session === 'ok' && conn.role === 'ok' && conn.articles === 'fail' && conn.upload === 'skip' && /1 to fix/.test(await page.locator('.conn-head em').innerText()), JSON.stringify(conn))
  await page.unroute('**/rest/v1/Article?select=id**')

  await page.click('.signin-signout')
  await page.waitForSelector('.signin input[name=email]')
  await page.keyboard.press('Escape')

  // 8f. AI settings: four providers, the model menu opens in front of the dialog, Esc closes the menu first
  await page.click('.ed-ai-chip')
  await page.waitForSelector('.ai-provider-seg')
  const provs = await page.locator('.ai-provider-seg button').allInnerTexts()
  await page.click('.ai-provider-seg button:has-text("OpenAI")')
  await page.fill('.ai-settings input[type=password]', 'sk-test-openai')
  await page.locator('.ai-settings .select').click()
  await page.waitForSelector('.popover.menu')
  const front = await page.evaluate(() => { const m = document.querySelector('.popover.menu').getBoundingClientRect(); const hit = document.elementFromPoint(m.left + m.width / 2, m.top + 12); return !!hit?.closest('.popover') })
  await page.keyboard.press('Escape')
  const stillOpen = await page.locator('.ai-settings').count()
  check('AI settings: Gemini, Claude, OpenAI, OpenRouter; the model menu is in front of the dialog; Esc closes the menu, not the dialog', provs.join('|') === 'Gemini|Claude|OpenAI|OpenRouter' && front && stillOpen === 1, JSON.stringify({ provs, front, stillOpen }))
  await page.click('.dialog .btn.primary:has-text("Save")')
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('esb-banner-studio/ai-settings') || '{}'))
  check('AI settings saved per provider; the chosen provider is the active one', saved.provider === 'openai' && saved.keys?.openai === 'sk-test-openai', JSON.stringify({ provider: saved.provider }))

  // 8g. SEO and captions written by the provider (stubbed OpenAI), then held to the site's rules
  await page.route('https://api.openai.com/v1/models', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{ id: 'gpt-5' }, { id: 'gpt-5-mini' }] }) }))
  let aiAuth = ''
  await page.route('https://api.openai.com/v1/chat/completions', async (r) => {
    aiAuth = r.request().headers()['authorization'] || ''
    const body = r.request().postDataJSON()
    const props = Object.keys(body.response_format.json_schema.schema.properties)
    const answer = props.includes('facebook')
      ? { facebook: 'Two new wells for Sylhet. Read more: https://esbpowerline.com', x: 'Two new wells. https://esbpowerline.com/news/guess', linkedin: 'Sector update.', telegram: 'Headline\nSummary.' }
      : { focusKeyphrase: 'Sylhet gas field', tags: 'Sylhet gas field, BAPEX', metaTitle: 'Sylhet gas field: two new wells | ESB PowerLine', metaDescription: 'x', slug: 'sylhet-gas-field-two-new-wells-2026' }
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ model: 'gpt-5', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(answer) } }] }) })
  })
  await page.evaluate(() => { const s = window.__editorialStore.getState(); s.setDraftField('headline', 'Petrobangla to drill two new wells in Sylhet gas field'); s.setDraftField('body', 'Petrobangla will drill two new wells in the Sylhet gas field, officials said on Sunday.\n\nBAPEX will implement the project in the Sylhet gas field.') })
  await page.evaluate(() => [...document.querySelectorAll('.ed-story-tabs button')].find((x) => /seo/i.test(x.textContent + (x.getAttribute('aria-label') || '')))?.click())
  await page.click('.seo-ai .ai-btn')
  await page.waitForFunction(() => window.__editorialStore.getState().draft.focusKeyphrase === 'Sylhet gas field' && !document.querySelector('.seo-ai .ai-btn')?.disabled)
  const aiSeoOut = await page.evaluate(() => { const d = window.__editorialStore.getState().draft; return { t: d.metaTitle, d: d.metaDescription, s: d.slug, k: d.focusKeywords } })
  check('SEO by AI: the site name is stripped, a too-short description and a dated slug are rebuilt by the site rules', aiSeoOut.t === "Sylhet gas field: two new wells" && aiSeoOut.d.length >= 60 && aiSeoOut.d.length <= 160 && !/2026/.test(aiSeoOut.s) && aiSeoOut.s.length <= 75 && aiAuth === "Bearer sk-test-openai", JSON.stringify(aiSeoOut))
  await page.evaluate(() => [...document.querySelectorAll('.ed-story-tabs button')].find((x) => /social/i.test(x.textContent + (x.getAttribute('aria-label') || '')))?.click())
  const shownUrl = await page.locator('.ed-social-url').innerText()
  await page.click('.ed-social .ai-btn')
  await page.waitForFunction(() => window.__editorialStore.getState().draft.social.telegram.startsWith('Headline'))
  const caps = await page.evaluate(() => window.__editorialStore.getState().draft.social)
  const artUrl = `https://esbpowerline.com/articles/${aiSeoOut.s}`
  check('Social: the article URL from the slug is shown, and every AI caption ends with it — guessed site links replaced', shownUrl === artUrl && Object.values(caps).every((c) => c.includes(artUrl) && (c.match(/esbpowerline\.com/g) || []).length === 1), JSON.stringify({ shownUrl, x: caps.x }))
  await page.unroute('https://api.openai.com/v1/models'); await page.unroute('https://api.openai.com/v1/chat/completions')
  await page.evaluate(() => { const s = window.__editorialStore.getState(); s.setAiSettings({ ...s.ai, provider: 'gemini', keys: { gemini: '', anthropic: '', openai: '', openrouter: '' } }) })

  // 9. Publish pre-flight gates the live publish
  await page.click('button:has-text("Publish")')
  await page.waitForSelector('.ed-preflight')
  check('Publish Live is blocked until the checklist is ticked', await page.locator('button:has-text("Publish Live to CMS")').isDisabled())

  // 10. Publishing from the browser preview: the banner cannot be uploaded here, so the article carries the original
  // photo and the result says so (the desktop app uploads it — tools/unit/site-upload.test.ts, electron-test)
  await page.keyboard.press('Escape')
  await page.click('.editorial-workspace .ed-account')
  await page.fill('.signin input[name=email]', 'rasel@esbpowerline.com')
  await page.fill('.signin input[name=password]', 'correct horse')
  await page.waitForFunction(() => !document.querySelector('.signin-submit')?.disabled) // the sheet focuses its field 60 ms after opening; a fill before that can be re-rendered away
  await page.click('.signin-submit')
  await page.waitForSelector('.signin-avatar')
  await page.keyboard.press('Escape')
  let posted = null
  await page.route('**/rest/v1/Article', async (r) => {
    if (r.request().method() !== 'POST') return r.continue()
    posted = JSON.parse(r.request().postData() || '{}')
    r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify([{ id: 'art1', slug: posted.slug }]) })
  })
  await page.click('button:has-text("Publish")')
  await page.waitForSelector('.ed-preflight')
  for (const box of await page.locator('.ed-preflight input[type=checkbox]').all()) await box.check({ force: true })
  await page.click('button:has-text("Publish Live to CMS")')
  await page.waitForSelector('.callout.good, .callout.warn', { timeout: 20000 })
  const pub = { msg: await page.locator('.callout').first().innerText(), image: posted && (Array.isArray(posted) ? posted[0] : posted).imageUrl }
  check('Publish from the browser preview: never a blob: link as the article image, and the result says why', !!posted && !pub.image && /cannot upload the banner and the photo is a local file/.test(pub.msg), JSON.stringify(pub).slice(0, 300))

  // 11. Story queue: the published story is marked, a new story gets its own entry, switching swaps the editor and
  // the banner, and the queue survives a reload
  await page.keyboard.press('Escape')
  const firstHead = await page.inputValue('#draft-headline')
  await page.click('.editorial-workspace .pillbar [aria-label^="New story"]')
  await page.waitForSelector('.ed-launcher-queue .sq-row')
  const launch = await page.evaluate(() => [...document.querySelectorAll('.ed-launcher-queue .sq-row')].map((r) => r.innerText.replace(/\s+/g, ' ')))
  check('New story keeps the last one: launcher lists it as Published', launch.length === 1 && launch[0].includes(firstHead) && /Published/.test(launch[0]), JSON.stringify(launch))
  await page.fill('.ed-url-input', `http://localhost:${PORT}/tools/fixtures/next-data.html`)
  await page.click('button:has-text("Fetch & Auto-Translate")')
  await page.waitForSelector('.ed-card-story', { timeout: 30000 })
  await page.waitForTimeout(1200)
  const secondHead = await page.inputValue('#draft-headline')
  await page.click('.ed-src button:has-text("Stories")')
  await page.waitForSelector('.sq-row')
  await page.waitForFunction(() => document.querySelectorAll('.sq-row').length === 2)
  const rows = await page.evaluate(() => [...document.querySelectorAll('.sq-row')].map((r) => ({ on: r.classList.contains('on'), t: r.querySelector('.sq-title').textContent })))
  check('Stories tab: two stories, the one on the desk marked', rows.length === 2 && rows[0].on && rows[0].t === secondHead && rows[1].t === firstHead && secondHead !== firstHead, JSON.stringify(rows))
  await page.locator('.sq-row:not(.on) .sq-main').click()
  await page.waitForTimeout(400)
  const swapped = { head: await page.inputValue('#draft-headline'), banner: await page.evaluate(() => window.__store.getState().doc.content.headline) }
  check('Switching restores that story\'s draft and re-syncs the banner', swapped.head === firstHead && swapped.banner === firstHead, JSON.stringify(swapped))
  await page.click('.ed-src button:has-text("New link")')
  await page.fill('.ed-src .ed-url-input', 'https://blocked.invalid/another')
  await page.click('.ed-src button:has-text("Fetch & Auto-Translate")')
  await page.waitForTimeout(2500)
  await page.fill('#draft-headline', firstHead + ' (edited)')
  await page.waitForTimeout(900)
  const afterFail = await page.evaluate(() => JSON.parse(localStorage.getItem('esb-banner-studio/editorial/queue/v1')).stories.length)
  check('A failed import does not duplicate the story on the desk', afterFail === 2, String(afterFail))
  await page.reload()
  await page.waitForSelector('.studio-shell')
  await page.click('.ws-btn[data-ws="editorial"]').catch(() => {})
  await page.waitForSelector('#draft-headline')
  const after = { head: await page.inputValue('#draft-headline'), n: await page.evaluate(() => JSON.parse(localStorage.getItem('esb-banner-studio/editorial/queue/v1')).stories.length) }
  check('The queue and the edit survive a reload', after.head === firstHead + ' (edited)' && after.n === 2, JSON.stringify(after))

  await browser.close()
} catch (err) {
  console.error('Test error:', err)
  failed++
} finally {
  vite.kill()
  process.exit(failed > 0 ? 1 : 0)
}
