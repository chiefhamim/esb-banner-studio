// The first Graphics open after launch: frame gaps while it arrives, and where the main thread went (CPU profile,
// top self-time functions). WAIT = ms after launch before opening (default 9000, after the idle prebuild).
// Usage: npm run build && node tools/audit/graphics-first-open.mjs
import { _electron as electron } from 'playwright-core'
import path from 'node:path'; import fs from 'node:fs'; import os from 'node:os'
const root = path.resolve(import.meta.dirname, '../..')
const app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [root, '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'esb-gfo-'))], env: { ...process.env, ESB_NO_SYNC: '1' } })
const page = await app.firstWindow(); page.setDefaultTimeout(30000)
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1600, 900))
await page.evaluate(() => { localStorage.setItem('esb-banner-studio/theme', 'dark'); localStorage.setItem('esb-banner-studio/workspace', JSON.stringify({ workspace: 'home' })) }); await page.reload()
await page.waitForSelector('.launch-tile')
await page.waitForTimeout(Number(process.env.WAIT || 9000))
await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; if (w.isMinimized()) w.restore(); w.showInactive(); w.setAlwaysOnTop(true); setTimeout(() => w.setAlwaysOnTop(false), 4000) })
await page.waitForTimeout(300)
const cdp = await page.context().newCDPSession(page)
const events = []
cdp.on('Tracing.dataCollected', (e) => events.push(...e.value))
const traced = new Promise((r) => cdp.once('Tracing.tracingComplete', r))
await cdp.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline,gpu,cc,viz,blink', transferMode: 'ReportEvents' })
await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start')
await page.evaluate(() => { window.__gaps = []; let last = performance.now(); const t0 = last; const f = (t) => { window.__gaps.push(Math.round(t - last)); last = t; if (t - t0 < 1500) requestAnimationFrame(f) }; requestAnimationFrame(f) })
await page.click('.launch-tile:has-text("Graphics")')
await page.waitForTimeout(1700)
const { profile } = await cdp.send('Profiler.stop')
await cdp.send('Tracing.end'); await traced
const long = events.filter((e) => e.ph === 'X' && e.dur > 15000).map((e) => `${(e.dur / 1000).toFixed(1)}ms ${e.name} [${e.tid}] ${JSON.stringify(e.args?.data ? { u: (e.args.data.url || '').split('/').pop().slice(0, 30), f: e.args.data.functionName, n: e.args.data.nodeName, w: e.args.data.width } : '').slice(0, 120)}`)
console.log('long events:\n' + long.slice(0, 40).join('\n'))
const gaps = await page.evaluate(() => window.__gaps)
console.log('frame gaps >12ms:', gaps.filter((g) => g > 12).join(' '), '| worst', Math.max(...gaps), '| frames', gaps.length)
const self = new Map(); const byId = new Map(profile.nodes.map((n) => [n.id, n]))
const dt = profile.timeDeltas; profile.samples.forEach((id, i) => { const n = byId.get(id); const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber}:${n.callFrame.columnNumber}`; self.set(k, (self.get(k) || 0) + (dt[i] || 0) / 1000) })
console.log([...self].filter(([k]) => !/\(idle\)|\(program\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 18).map(([k, v]) => `${v.toFixed(1)}ms ${k}`).join('\n'))
await app.close()
