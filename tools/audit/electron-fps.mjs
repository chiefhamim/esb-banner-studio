// Real-renderer frame pacing: rAF intervals while the app idles and during each common interaction, against the monitor.
// Usage: npm run build && node tools/audit/electron-fps.mjs
import { _electron as electron } from 'playwright-core'
import path from 'node:path'; import fs from 'node:fs'; import os from 'node:os'
const root = path.resolve(import.meta.dirname, '../..')
const win = process.platform === 'win32'
const exe = path.join(root, 'node_modules', 'electron', 'dist', win ? 'electron.exe' : 'electron')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'esb-fps-'))
const app = await electron.launch({ executablePath: exe, args: [root, '--user-data-dir=' + profile], env: { ...process.env, ESB_NO_SYNC: '1' } })
const page = await app.firstWindow(); page.setDefaultTimeout(20000)
await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setContentSize(1600, 900); w.focus() })
await page.waitForTimeout(3000)
const gpu = await app.evaluate(({ app }) => app.getGPUFeatureStatus())
console.log('gpu', JSON.stringify({ compositing: gpu.gpu_compositing, webgl: gpu.webgl, rasterization: gpu.rasterization }))
await page.addInitScript(() => { window.__customTranslator = async (t) => 'Petrobangla will drill two new wells at Tk 592 crore. ' + t.length })
await page.evaluate(() => localStorage.setItem('esb-banner-studio/theme', 'dark')); await page.reload(); await page.waitForTimeout(1500)
await page.evaluate(() => { window.__rec = (ms) => new Promise((res) => { const d = []; let last = performance.now(); const t0 = last; const lt = []; const po = new PerformanceObserver((l) => { for (const e of l.getEntries()) lt.push(Math.round(e.duration)) }); po.observe({ type: 'longtask' }); const f = (n) => { d.push(n - last); last = n; if (n - t0 < ms) requestAnimationFrame(f); else { po.disconnect(); res({ d, lt }) } }; requestAnimationFrame(f) }) })
const report = (name, { d, lt }) => {
  const s = [...d].sort((a, b) => a - b); const med = s[Math.floor(s.length / 2)]; const p95 = s[Math.floor(s.length * .95)]
  const period = med; const dropped = d.filter((x) => x > period * 1.6).length
  console.log(`${name.padEnd(22)} fps ${(1000 / med).toFixed(1).padStart(5)}  p95 ${p95.toFixed(1).padStart(5)} ms  worst ${Math.max(...d).toFixed(1).padStart(6)} ms  dropped ${String(dropped).padStart(3)}/${d.length}  longtasks ${JSON.stringify(lt)}`)
}
const during = async (name, act, ms = 900) => { const p = page.evaluate((m) => window.__rec(m), ms); await page.waitForTimeout(30); await act(); report(name, await p); await page.waitForTimeout(300) }
const click = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel)
const ws = (id) => page.evaluate((i) => { const b = document.querySelector('.ws-btn[data-ws="' + i + '"]') || [...document.querySelectorAll('.home-shell button, .launch-tile')].find((x) => (x.textContent || '').trim().toLowerCase().startsWith(i)); b?.click(); return !!b }, id)
report('idle home', await page.evaluate(() => window.__rec(1000)))
await during('desk: home->graphics', () => ws('graphics'), 1200)
report('idle graphics', await page.evaluate(() => window.__rec(1000)))
await during('fold left column', () => click('.col-fold.left'))
await during('open left column', () => click('.col-fold.left'))
await during('side tab switch', () => page.evaluate(() => document.querySelectorAll('.left .side-tabs button')[1]?.click()))
await during('hover sweep tools', async () => { for (const b of await page.$$('.toolbar .ibtn')) await b.hover() })
await during('desk: graphics->news', () => ws('news'), 1200)
await during('desk: news->outreach', () => ws('outreach'), 1200)
await during('desk: outreach->editorial', () => ws('editorial'), 1200)
await during('scroll editorial queue', async () => { await page.mouse.move(800, 500); for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, 240); await page.waitForTimeout(40) } })
// heavy work: processing a pasted story, then scrolling it
await ws('editorial'); await page.waitForTimeout(900)
await page.screenshot({ path: 'artifacts/fps-ed.png' })
await page.locator('.ed-launcher button[aria-label="Paste Text or File"], button:has-text("Text or file")').first().click()
await page.fill('.ed-paste-area', Array.from({ length: 30 }, (_, i) => `সিলেট গ্যাস ফিল্ডের আওতায় দুটি নতুন উন্নয়ন কূপ খননের উদ্যোগ নিয়েছে পেট্রোবাংলা ও বাপেক্স। অনুচ্ছেদ ${i + 1}।`).join(String.fromCharCode(10)))
await during('process story (busy)', () => page.click('button:has-text("Process Story")'), 2500)
await page.waitForSelector('.ed-card-story', { timeout: 40000 }); await page.waitForTimeout(800)
await during('scroll story', async () => { await page.mouse.move(700, 600); for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, 300); await page.waitForTimeout(40) } })
await during('story tab Body->SEO', () => page.evaluate(() => [...document.querySelectorAll('.seg-ctl button, .side-tabs button')].find((b) => /SEO/.test(b.textContent || ''))?.click()))
// Outreach with a 2,000-row list
const big = ['Serial,Person Name,Designation,Organization,Sector Group,Email,Phone,Purpose,Mail Server,Deliverability Status,Address', ...Array.from({ length: 2000 }, (_, i) => `${i + 1},Contact ${i + 1},Engineer,Org ${i % 90},Power,c${i}@org${i % 90}.example.org,,News,,SAFE_TO_SEND,Dhaka`)].join(String.fromCharCode(10))
const csv = path.join(profile, 'big.csv'); fs.writeFileSync(csv, big)
await ws('outreach'); await page.waitForTimeout(1200)
await during('import 2,000 contacts', () => page.setInputFiles('.outreach-workspace input[accept=".xlsx,.csv,.xls"] >> nth=0', csv), 2500)
await during('scroll contact list', async () => { const r = await page.locator('.or-list').boundingBox(); if (r) await page.mouse.move(r.x + r.width / 2, r.y + 200); for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, 400); await page.waitForTimeout(40) } })
await during('filter chip Ready', () => page.evaluate(() => [...document.querySelectorAll('.or-filter button, .or-filter .chip')].find((b) => /Ready/.test(b.textContent || ''))?.click()))
await app.close()
