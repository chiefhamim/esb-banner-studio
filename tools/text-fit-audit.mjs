// Text-fit audit: every workspace, panel, tab, dialog and menu, filled with deliberately long newsroom content, at
// laptop and desktop widths. Reports text a reader cannot fully see:
//   cut-x      text or a field's value wider than its box, cut off with no ellipsis
//   cut-y      text taller than a box that hides overflow (not a deliberate line clamp, not a scroll area)
//   spill      text drawn outside its own box onto whatever is next to it
//   page-x     the page itself scrolls sideways
//   hidden     text cut by a clipping ancestor (it scrolls nowhere, so it is simply lost)
// Ellipsis truncation is listed separately (`trunc`) — it is a choice, but every one should be a deliberate one.
//
//   node tools/text-fit-audit.mjs            # 1280 1366 1600 1920
//   W=1366 node tools/text-fit-audit.mjs     # one width
//   SHOTS=dir node tools/text-fit-audit.mjs  # also screenshot each state
import { chromium } from 'playwright-core'
import { launchBrowser } from './launch-browser.mjs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

const PORT = 5196
const root = path.resolve(import.meta.dirname, '..')
const widths = process.env.W ? process.env.W.split(',').map(Number) : [1280, 1366, 1600, 1920]
const shots = process.env.SHOTS
if (shots) fs.mkdirSync(shots, { recursive: true })
const vite = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break } catch {} await new Promise((r) => setTimeout(r, 500)) }

// long but realistic: a full-length headline, a compound proper noun, a long name, a long email, many tags
const LONG = {
  headline: 'Bangladesh–India Cross-Border Transmission Interconnection Raises Rooppur Nuclear Grid Capacity by 1,200 MW',
  deck: 'The Bangladesh Power Development Board says the 400 kV double-circuit Bheramara–Baharampur interconnection upgrade will raise firm import capacity before the 2027 summer peak, easing load-shedding.',
  keyphrase: 'Bheramara–Baharampur HVDC interconnection capacity upgrade',
  tags: 'Bheramara-Baharampur HVDC, Power Grid Company of Bangladesh, cross-border electricity trade, Rooppur Nuclear Power Plant, load-shedding, summer peak demand',
  byline: 'Mehedi Hasan Hamim Chowdhury, Senior Energy Correspondent',
  credit: 'Photo: Power Grid Company of Bangladesh Limited (PGCB) / Bangladesh Power Development Board',
  email: 'mehedi.hasan.hamim.chowdhury@esbpowerline.com',
}

const found = new Map()
let browser
try {
  browser = await launchBrowser(chromium)
  for (const W of widths) {
    const ctx = await browser.newContext({ viewport: { width: W, height: W >= 1600 ? 1000 : 800 } })
    const page = await ctx.newPage()
    page.setDefaultTimeout(6000)
    await page.addInitScript(() => { window.__customTranslator = async (x) => x.replace(/[ঀ-৿]+/g, 'transmission') })
    await page.route('**/media/**', (r) => r.fulfill({ path: path.join(root, 'tools/fixtures/media/synthetic-rig.jpg'), contentType: 'image/jpeg' }))
    await page.route('**/auth/v1/token**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_in: 3600, user: { id: 'u', email: LONG.email, user_metadata: {}, app_metadata: {} } }) }))
    await page.route('**/rest/v1/profiles**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ role: 'SUPER_ADMIN', status: 'ACTIVE', full_name: 'Mehedi Hasan Hamim Chowdhury' }]) }))
    await page.route('**/auth/v1/health**', (r) => r.fulfill({ status: 200, body: '{}' }))
    await page.route('**/auth/v1/user**', (r) => r.fulfill({ status: 200, body: '{}' }))
    await page.route('**/rest/v1/Article?select=id**', (r) => r.fulfill({ status: 403, contentType: 'application/json', body: '{"message":"permission denied for table Article — row level security policy"}' }))
    await page.goto(`http://localhost:${PORT}/`)
    await page.waitForSelector('.studio-shell')
    await page.waitForTimeout(500)

    const audit = async (state) => {
      if (shots) await page.screenshot({ path: path.join(shots, `${W}-${state.replace(/[^a-z0-9]+/gi, '_')}.png`) })
      const list = await page.evaluate(() => {
        const out = []
        const name = (el) => { const p = []; for (let e = el; e && e !== document.body && p.length < 3; e = e.parentElement) p.push(e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '')); return p.join(' < ') }
        const shown = (el) => { const r = el.getBoundingClientRect(); const c = getComputedStyle(el); return r.width > 0 && r.height > 0 && c.visibility !== 'hidden' && c.display !== 'none' && +c.opacity > 0.05 }
        const scrolls = (c, axis) => /(auto|scroll)/.test(axis === 'x' ? c.overflowX : c.overflowY)
        if (document.documentElement.scrollWidth > innerWidth + 1) out.push({ kind: 'page-x', el: 'html', text: '', d: document.documentElement.scrollWidth - innerWidth })
        for (const el of document.querySelectorAll('body *')) {
          if (!shown(el) || el.closest('svg, canvas, .stage-area, .stage, .ed-site-frame, .sp-root, .vw-canvas, .fi-canvas, [data-audit-skip]')) continue
          const c = getComputedStyle(el)
          const isField = el.tagName === 'INPUT' && /^(text|email|url|search|password|)$/.test(el.type) || el.tagName === 'TEXTAREA'
          const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim())
          const text = (isField ? el.value : el.textContent).trim().replace(/\s+/g, ' ').slice(0, 50)
          if (!own.length && !isField) continue
          // horizontal: wider than the box
          if (el.scrollWidth > el.clientWidth + 1 && !scrolls(c, 'x') && !(isField && document.activeElement === el)) {
            const trunc = c.textOverflow === 'ellipsis'
            if (isField && el.tagName === 'INPUT') out.push({ kind: 'field-cut', el: name(el), text, d: el.scrollWidth - el.clientWidth })
            else if (el.tagName !== 'TEXTAREA') out.push({ kind: trunc ? 'trunc' : (c.overflowX === 'visible' ? 'spill' : 'cut-x'), el: name(el), text, d: el.scrollWidth - el.clientWidth })
          }
          // vertical: taller than a box that hides it, unless a deliberate line clamp
          if (!isField && c.overflowY !== 'visible' && !scrolls(c, 'y') && el.scrollHeight > el.clientHeight + 2 && c.webkitLineClamp === 'none') out.push({ kind: 'cut-y', el: name(el), text, d: el.scrollHeight - el.clientHeight })
          if (isField) continue
          // spill: the text's own rectangles outside the element's box
          const range = document.createRange()
          for (const n of own) {
            range.selectNodeContents(n)
            const er = el.getBoundingClientRect()
            for (const r of range.getClientRects()) {
              if (r.width < 1) continue
              const over = Math.max(r.right - er.right, er.left - r.left, r.bottom - er.bottom - 2)
              if (over > 1.5 && c.overflowX === 'visible' && c.overflowY === 'visible') { out.push({ kind: 'spill', el: name(el), text, d: Math.round(over) }); break }
            }
            // hidden: cut by a clipping ancestor that does not scroll that way
            let lost = 0
            for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
              const ac = getComputedStyle(a)
              if (scrolls(ac, 'x') || scrolls(ac, 'y')) break // inside a scroll area: reachable by scrolling
              const clipX = ac.overflowX !== 'visible'
              const clipY = ac.overflowY !== 'visible'
              if (!clipX && !clipY) continue
              const ar = a.getBoundingClientRect()
              for (const r of range.getClientRects()) {
                if (r.width < 1) continue
                if (clipX) lost = Math.max(lost, r.right - ar.right, ar.left - r.left)
                if (clipY) lost = Math.max(lost, r.bottom - ar.bottom, ar.top - r.top)
              }
              if (lost > 2) break
            }
            if (lost > 2 && c.textOverflow !== 'ellipsis') { out.push({ kind: 'hidden', el: name(el), text, d: Math.round(lost) }); break }
          }
        }
        return out
      })
      for (const f of list) {
        const key = f.kind + '|' + f.el + '|' + f.text
        const prev = found.get(key)
        if (prev) { prev.where.add(`${W}:${state}`); prev.d = Math.max(prev.d, f.d) } else found.set(key, { ...f, where: new Set([`${W}:${state}`]) })
      }
    }
    // under 1180 px the source column is a slide-over that starts closed
    const ensureSource = async () => { if (!(await page.locator('.ed-src').isVisible().catch(() => false)) || !(await page.locator('.ed-src .side-tabs').isVisible().catch(() => false))) await page.locator('.ed-head .pv-btn:has(.ed-head-host)').click({ timeout: 2000 }).catch(() => {}); await page.waitForTimeout(300) }
    // the scrim sits under the slide-over too: click its uncovered right-hand part, as a reader would
    const closeSource = async () => { const sc = page.locator('.ed-src-scrim'); const box = await sc.boundingBox().catch(() => null); if (box) { await page.mouse.click(box.x + box.width - 30, box.y + box.height / 2); await page.waitForTimeout(400) } }
    const tryStep = async (label, fn) => { try { await fn(); await page.waitForTimeout(250); await audit(label) } catch (e) { console.log(`  (skipped ${W}:${label}: ${e.message.split('\n')[0]})`) } }
    const openEach = async (scope, label) => {
      const n = await page.locator(`${scope} .pnl > header`).count()
      for (let i = 0; i < n; i++) {
        const h = page.locator(`${scope} .pnl > header`).nth(i)
        const panel = await h.locator('xpath=..').getAttribute('data-panel')
        await tryStep(`${label}:${panel ?? i}`, async () => { if (!(await h.locator('xpath=..').getAttribute('class')).includes('open')) await h.click() })
      }
    }

    // ---- Home
    await tryStep('home', async () => { await page.click('[data-ws="home"]') })
    // ---- Graphics, with a long headline, credit and caption
    // Home has no workspace switcher: its launch tile opens Graphics
    await page.evaluate(() => [...document.querySelectorAll('.launch-tile')].find((e) => /Graphics/.test(e.textContent))?.click())
    await page.waitForTimeout(400)
    await page.evaluate((L) => window.__store.getState().setContent({ headline: L.headline, credit: L.credit, caption: L.deck }), LONG)
    await page.setInputFiles('.left input[type=file]', path.join(root, 'tools/fixtures/media/synthetic-rig.jpg')).catch(() => {})
    await tryStep('graphics', async () => {})
    await openEach('.left', 'graphics-story')
    await tryStep('graphics-photos', async () => { await page.click('.left .side-tabs button:has-text("Photos")') })
    await openEach('.left', 'graphics-photos')
    await openEach('.right', 'graphics-right')
    for (const m of ['File', 'Edit', 'View', 'Arrange']) await tryStep(`graphics-menu-${m}`, async () => { await page.click(`.topbar .menubar .mb-item:has-text("${m}")`) }).then(() => page.keyboard.press('Escape'))
    await tryStep('graphics-export-menu', async () => { await page.click('.split-caret') })
    await page.keyboard.press('Escape')
    await tryStep('graphics-export-dialog', async () => { await page.click('.split > .btn.primary:not(.split-caret)'); await page.waitForSelector('.dialog') })
    await page.keyboard.press('Escape')

    // ---- Editorial: a story, then everything set long
    await page.keyboard.press('Escape')
    await page.locator('.dialog .ibtn[aria-label="Close"], .dialog button:has-text("Cancel")').first().click({ timeout: 1000 }).catch(() => {})
    await page.click('.ws-btn[data-ws="editorial"]')
    await page.waitForSelector('.editorial-workspace')
    await tryStep('editorial-launch', async () => {})
    // a headline typed in Graphics already opens a desk (the banner link is two-way): load through its "New link" tab,
    // which under 1180 px lives in the source slide-over
    if (!(await page.locator('.ed-url-input:visible').count())) {
      await ensureSource()
      if (!(await page.locator('.ed-url-input:visible').count())) await page.click('.ed-src button:has-text("New link")')
    }
    await page.locator('.ed-url-input:visible').first().fill(`http://localhost:${PORT}/tools/fixtures/jsonld-news.html`)
    await page.locator('button:has-text("Fetch & Auto-Translate"):visible').first().click()
    await page.waitForSelector('.ed-card-story', { timeout: 30000 })
    await page.waitForTimeout(1200)
    await page.evaluate((L) => {
      const s = window.__editorialStore.getState()
      s.setDraftField('headline', L.headline); s.setDraftField('deck', L.deck); s.setDraftField('focusKeyphrase', L.keyphrase)
      s.setDraftField('focusKeywords', L.tags); s.setDraftField('byline', L.byline); s.setDraftField('credit', L.credit)
      s.setDraftField('slug', 'bangladesh-india-cross-border-transmission-interconnection-raises-rooppur-capacity')
    }, LONG)
    await tryStep('ed-desk', async () => {})
    await ensureSource()
    await openEach('.ed-src', 'ed-left')
    await tryStep('ed-left-stories', async () => { await page.click('.ed-src button:has-text("Stories")') })
    await tryStep('ed-left-newlink', async () => { await page.click('.ed-src button:has-text("New link")') })
    await page.click('.ed-src button:has-text("Source")').catch(() => {})
    await closeSource()
    for (const t of ['Body', 'SEO', 'Social', 'Preview']) await tryStep(`ed-center-${t}`, async () => { await page.click(`.ed-story-tabs button:has-text("${t}")`) })
    await page.click('.ed-story-tabs button:has-text("Body")').catch(() => {})
    await openEach('.ed-side', 'ed-right')
    for (const t of ['Banner', 'Web article', 'Facebook']) await tryStep(`ed-outputs-${t}`, async () => { if (!(await page.locator('[data-panel="ed-outputs"].open').count())) await page.click('[data-panel="ed-outputs"] > header'); await page.click(`.ed-outputs-tabs button:has-text("${t}")`); await page.waitForTimeout(600) })
    for (const m of ['Story', 'Site', 'View']) { await tryStep(`ed-menu-${m}`, async () => { await page.click(`.ed-head .menubar .mb-item:has-text("${m}")`) }); await page.keyboard.press('Escape') }
    await tryStep('ed-apikey', async () => { await page.click('.ed-head .ed-ai-chip'); await page.waitForSelector('.dialog') })
    await page.keyboard.press('Escape')
    await tryStep('ed-signin', async () => { await page.click('.ed-head .ed-account'); await page.waitForSelector('.signin') })
    await page.fill('.signin input[name=email]', LONG.email).catch(() => {})
    await page.fill('.signin input[name=password]', 'x').catch(() => {})
    await tryStep('ed-signin-account', async () => { await page.click('.signin-submit'); await page.waitForSelector('.signin-avatar') })
    await tryStep('ed-signin-check', async () => { await page.click('.conn-run'); await page.waitForSelector('.conn-row[data-check="gemini"]', { timeout: 15000 }) })
    await page.keyboard.press('Escape')
    await tryStep('ed-publish', async () => { await page.click('.ed-head > .btn.primary:has-text("Publish")'); await page.waitForSelector('.ed-preflight') })
    await page.keyboard.press('Escape')

    // ---- Video
    await page.click('.ws-btn[data-ws="video"]')
    await page.waitForTimeout(500)
    for (const t of ['Media Bin', 'Overlays', 'Captions', 'Audio', 'Story']) await tryStep(`video-${t}`, async () => { await page.click(`.vw-bin-tabs button:has-text("${t}")`) })
    await tryStep('video-story-built', async () => { await page.click('.vw-story-build'); await page.click('.vw-story-confirm button:has-text("Replace")'); await page.waitForSelector('.vw-story-note') })
    await tryStep('video-clip-selected', async () => { await page.locator('.vw-clip-block').first().click() })
    await tryStep('video-export', async () => { await page.click('.vw-header-actions button:has-text("Export")'); await page.waitForSelector('.vx') })
    await page.keyboard.press('Escape')
    await ctx.close()
  }
} finally {
  await browser?.close()
  vite.kill()
}

const order = ['page-x', 'hidden', 'cut-x', 'cut-y', 'spill', 'field-cut', 'trunc']
const rows = [...found.values()].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || b.d - a.d)
for (const kind of order) {
  const of = rows.filter((r) => r.kind === kind)
  if (!of.length) continue
  console.log(`\n${kind} (${of.length})`)
  for (const r of of) console.log(`  ${String(r.d).padStart(4)}px  ${r.el}  «${r.text}»  @ ${[...r.where].slice(0, 3).join(', ')}${r.where.size > 3 ? ` +${r.where.size - 3}` : ''}`)
}
const bad = rows.filter((r) => r.kind !== 'trunc' && r.kind !== 'field-cut').length
console.log(`\n${bad} text-fit problems, ${rows.filter((r) => r.kind === 'trunc').length} ellipsis truncations, ${rows.filter((r) => r.kind === 'field-cut').length} long field values (scroll inside the field)`)
process.exit(0)
