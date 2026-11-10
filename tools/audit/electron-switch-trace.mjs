// What one desk switch costs, by phase (kept-alive desks, second visit).
import { _electron as electron } from 'playwright-core'
import path from 'node:path'; import fs from 'node:fs'; import os from 'node:os'
const root = path.resolve(import.meta.dirname, '../..')
const app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [root, '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'esb-sw-'))], env: { ...process.env, ESB_NO_SYNC: '1' } })
const page = await app.firstWindow(); page.setDefaultTimeout(30000)
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1600, 900))
await page.evaluate(() => localStorage.setItem('esb-banner-studio/theme', 'dark')); await page.reload(); await page.waitForTimeout(1500)
const ws = (id) => page.evaluate((i) => { const b = document.querySelector('.ws-btn[data-ws="' + i + '"]') || [...document.querySelectorAll('.home-shell button, .launch-tile')].find((x) => (x.textContent || '').trim().toLowerCase().startsWith(i)); b?.click() }, id)
for (const d of ['news', 'editorial', 'graphics', 'outreach', 'editorial']) { await ws(d); await page.waitForTimeout(1300) }
const cdp = await page.context().newCDPSession(page)
for (const target of ['news', 'graphics']) {
  const events = []
  cdp.on('Tracing.dataCollected', (e) => events.push(...e.value))
  const done = new Promise((r) => cdp.once('Tracing.tracingComplete', r))
  await cdp.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline,v8.execute', transferMode: 'ReportEvents' })
  await ws(target); await page.waitForTimeout(900)
  await cdp.send('Tracing.end'); await done
  const by = {}
  for (const e of events) if (e.ph === 'X' && e.dur && e.dur > 500) { by[e.name] = (by[e.name] || 0) + e.dur / 1000 }
  console.log('-> ' + target, Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k} ${v.toFixed(1)}ms`).join(' · '))
  const big = events.filter((e) => e.ph === 'X' && e.dur > 8000 && /Layout|UpdateLayoutTree|Paint|FunctionCall|RecalculateStyles|PrePaint/.test(e.name)).map((e) => `${e.name} ${(e.dur / 1000).toFixed(1)}ms ${JSON.stringify(e.args?.data ? { f: e.args.data.functionName, u: (e.args.data.url || '').split('/').pop(), l: e.args.data.lineNumber, c: e.args.data.columnNumber } : '')}`)
  console.log('   big:', big.join(' | '))
  cdp.removeAllListeners('Tracing.dataCollected')
}
await app.close()
