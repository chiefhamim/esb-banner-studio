// Runs the article extractor against the hand-written pages in tools/fixtures through the real
// renderer (DOMParser), via the window.__esbParseArticle test seam. No network, no live sites.
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { launchBrowser } from '../launch-browser.mjs'

const PORT = 5192
const root = path.resolve(import.meta.dirname, '../..')
const vite = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' })
const waitUp = async () => { for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) return } catch {} await new Promise((r) => setTimeout(r, 500)) } throw new Error('Vite did not start') }

let browser
let failed = 0
const check = (name, ok, extra = '') => { console.log(ok ? 'PASS' : 'FAIL', name, extra); if (!ok) failed++ }
const fixture = (name) => fs.readFileSync(path.join(root, 'tools', 'fixtures', name), 'utf8')

try {
  await waitUp()
  browser = await launchBrowser(chromium)
  const page = await browser.newPage()
  await page.goto(`http://localhost:${PORT}/`)
  await page.waitForFunction(() => typeof window.__esbParseArticle === 'function')
  const parse = (name, url) => page.evaluate(([html, u]) => window.__esbParseArticle(html, u), [fixture(name), url])

  // 1. schema.org NewsArticle inside @graph, beside nav / related / footer noise
  const a = await parse('jsonld-news.html', 'https://example-news.test/economy/gas-wells-sylhet')
  check('JSON-LD: headline used, site suffix dropped', a.title === 'গ্যাস সরবরাহ বাড়াতে সিলেটে দুটি নতুন কূপ', a.title)
  check('JSON-LD: four story paragraphs, nothing from nav/related/footer', a.paragraphs.length === 4 && !a.paragraphs.some((p) => /সর্বস্বত্ব|কারওয়ান|এলএনজি আমদানিতে|শেয়ার করুন/.test(p)), String(a.paragraphs.length))
  check('JSON-LD: a sentence mentioning Gulshan is kept', a.paragraphs.some((p) => p.includes('গুলশান')))
  check('JSON-LD: datePublished, author and publisher come through', a.publishedAt === '2026-10-22T09:30:00+06:00' && a.byline === 'নিজস্ব প্রতিবেদক' && a.publisher === 'দৈনিক উদাহরণ', `${a.publishedAt} / ${a.byline} / ${a.publisher}`)
  check('JSON-LD: lead image is the ImageObject with its caption and credit', a.images[0]?.src === 'https://example-news.test/media/2026/10/well-rig-1200.jpg' && a.images[0]?.credit === 'সংগৃহীত', JSON.stringify(a.images[0]))
  check('JSON-LD: related-rail thumbnail (120x80) is not a story photo', !a.images.some((i) => i.src.includes('thumbs')))
  check('JSON-LD: report says Bengali, no warnings', a.meta?.language === 'bn' && a.meta?.warnings.length === 0 && ['structured', 'markup'].includes(a.meta?.method), JSON.stringify(a.meta))
  check('JSON-LD: deck is the description, not the headline', a.deck?.startsWith('পেট্রোবাংলা ও বাপেক্স'), a.deck)

  // 2. plain markup: scored story block vs. a related-stories rail of links; address line dropped, prose kept
  const b = await parse('markup-only.html', 'https://example-standard.test/power/pgcb-mohakhali')
  check('Markup: og:site_name suffix stripped from <title>', b.title === 'PGCB to raise capacity of Mohakhali grid line', b.title)
  check('Markup: five story paragraphs, none from the related rail', b.paragraphs.length === 5 && !b.paragraphs.some((p) => /DESCO moves|BERC hearing|Summit Power signs/.test(p)), String(b.paragraphs.length))
  check('Markup: "transmission tower", "road" and "block of land" sentences survive the address filter', b.paragraphs.some((p) => p.includes('transmission tower')) && b.paragraphs.some((p) => p.includes('Mohakhali road')) && b.paragraphs.some((p) => p.includes('block of land')))
  check('Markup: a long paragraph starting with a weekday is kept', b.paragraphs.some((p) => p.startsWith('শুক্রবার')))
  check('Markup: the footer address block is dropped', !b.paragraphs.some((p) => /Dhaka-1216|Copyright/.test(p)))
  check('Markup: byline "By " prefix removed; date from article:published_time', b.byline === 'Staff Correspondent' && b.publishedAt === '2026-10-21T18:05:00+06:00', `${b.byline} / ${b.publishedAt}`)
  check('Markup: 1x1 spacer skipped, 900x600 photo kept', b.images.length === 1 && b.images[0].src.endsWith('/img/line.jpg'), JSON.stringify(b.images.map((i) => i.src)))
  check('Markup: report names the story block', b.meta?.method === 'markup' && /story-body/.test(b.meta?.contentSelector || '') && b.meta?.language === 'mixed', JSON.stringify(b.meta))

  // 3. story only in __NEXT_DATA__
  const c = await parse('next-data.html', 'https://example-app.test/story/hearing')
  check('Page data: three paragraphs recovered from __NEXT_DATA__', c.paragraphs.length === 3 && c.paragraphs[0].startsWith('বাংলাদেশ এনার্জি রেগুলেটরি কমিশন'), String(c.paragraphs.length))
  check('Page data: method and warning say so', c.meta?.method === 'page-data' && c.meta?.warnings.some((w) => /embedded data/.test(w)), JSON.stringify(c.meta))
  check('Page data: og:image still found', c.images[0]?.src === 'https://cdn.example-app.test/hero/hearing.jpg')

  // 4. subscription wall
  const d = await parse('paywall.html', 'https://example-premium.test/lng')
  check('Paywall: one paragraph, subscription warning raised', d.paragraphs.length === 1 && d.meta?.warnings.some((w) => /subscription/i.test(w)), JSON.stringify(d.meta))
  check('Paywall: the "Subscribe to continue" line is not a paragraph', !d.paragraphs.some((p) => /Subscribe to continue/.test(p)))

  await browser.close()
} catch (err) {
  console.error('Test error:', err)
  failed++
} finally {
  vite.kill()
  console.log(failed === 0 ? 'ALL PASS' : `SOME FAILED (${failed})`)
  process.exit(failed === 0 ? 0 : 1)
}
