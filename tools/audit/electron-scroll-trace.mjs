// What a scroll costs, by phase: a devtools.timeline trace over a wheel scroll of the 2,000-contact list and a long story.
import { _electron as electron } from 'playwright-core'
import path from 'node:path'; import fs from 'node:fs'; import os from 'node:os'
const root = path.resolve(import.meta.dirname, '../..')
const exe = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'esb-tr-'))
const app = await electron.launch({ executablePath: exe, args: [root, '--user-data-dir=' + profile], env: { ...process.env, ESB_NO_SYNC: '1' } })
const page = await app.firstWindow(); page.setDefaultTimeout(30000)
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1600, 900))
await page.addInitScript(() => { window.__customTranslator = async (t) => 'Petrobangla will drill two new wells at Tk 592 crore, adding 30 MMCFD of gas. ' + t.length })
await page.evaluate(() => localStorage.setItem('esb-banner-studio/theme', 'dark')); await page.reload(); await page.waitForTimeout(1500)
const ws = (id) => page.evaluate((i) => { const b = document.querySelector('.ws-btn[data-ws="' + i + '"]') || [...document.querySelectorAll('.home-shell button, .launch-tile')].find((x) => (x.textContent || '').trim().toLowerCase().startsWith(i)); b?.click() }, id)
const cdp = await page.context().newCDPSession(page)
const trace = async (name, act) => {
  const events = []
  cdp.on('Tracing.dataCollected', (e) => events.push(...e.value))
  const done = new Promise((r) => cdp.once('Tracing.tracingComplete', r))
  await cdp.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.frame,benchmark,cc', transferMode: 'ReportEvents' })
  await act()
  await cdp.send('Tracing.end'); await done
  const by = {}
  for (const e of events) if (e.ph === 'X' && e.dur) { by[e.name] = (by[e.name] || 0) + e.dur / 1000 }
  const top = Object.entries(by).filter(([k]) => /Paint|Layout|UpdateLayoutTree|RecalculateStyles|FunctionCall|EventDispatch|Layerize|PrePaint|Composite|HitTest|ScrollLayer|UpdateLayer|Commit|v8|GC|RunTask/i.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 12)
  const pr = events.filter((e) => e.name === 'PipelineReporter' && e.ph === 'b')
  const states = {}; for (const e of pr) { const f = e.args?.frame_reporter || {}; const st = (f.state || '?') + (f.affects_smoothness ? ' (smooth-critical)' : '') + (f.checkerboarded_needs_raster ? ' checker' : '') + (f.scroll_state && f.scroll_state !== 'SCROLL_NONE' ? ' ' + f.scroll_state : ''); states[st] = (states[st] || 0) + 1 }
  console.log(name, 'frames:', JSON.stringify(states))
  console.log(name, top.map(([k, v]) => `${k} ${v.toFixed(0)}ms`).join(' · '))
  cdp.removeAllListeners('Tracing.dataCollected')
}
const big = ['Serial,Person Name,Designation,Organization,Sector Group,Email,Phone,Purpose,Mail Server,Deliverability Status,Address', ...Array.from({ length: 2000 }, (_, i) => `${i + 1},Contact ${i + 1},Engineer,Org ${i % 90},Power,c${i}@org${i % 90}.example.org,,News,,SAFE_TO_SEND,Dhaka`)].join(String.fromCharCode(10))
const csv = path.join(profile, 'big.csv'); fs.writeFileSync(csv, big)
await ws('outreach'); await page.waitForTimeout(1500)
await page.setInputFiles('.outreach-workspace input[accept=".xlsx,.csv,.xls"] >> nth=0', csv); await page.waitForTimeout(2500)
const r = await page.locator('.or-list').boundingBox(); await page.mouse.move(r.x + r.width / 2, r.y + 220)
await trace('contacts scroll:', async () => { for (let i = 0; i < 14; i++) { await page.mouse.wheel(0, 400); await page.waitForTimeout(40) } await page.waitForTimeout(300) })
await page.mouse.move(r.x + r.width + 400, 20)
await trace('contacts scroll (pointer away from rows):', async () => { await page.evaluate(() => { const l = document.querySelector('.or-list'); let n = 0; const f = () => { l.scrollTop += 120; if (++n < 40) requestAnimationFrame(f) }; requestAnimationFrame(f) }); await page.waitForTimeout(700) })
await app.close()
