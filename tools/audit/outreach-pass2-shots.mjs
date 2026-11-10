// Pass-2 audit shots: Activity Overview/Reports/Session with data, right Contact/Review tabs,
// popups (Export, Engine, assistant), and the pill-slide settle after Compose→Activity.
// Usage: npm run build && node tools/audit/outreach-pass2-shots.mjs → artifacts/outreach-pass2/*.png
import { _electron as electron } from 'playwright-core'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const root = path.resolve(import.meta.dirname, '../..')
const out = path.join(root, 'artifacts', 'outreach-pass2')
fs.mkdirSync(out, { recursive: true })
const win = process.platform === 'win32'
const exe = path.join(root, 'node_modules', 'electron', 'dist', win ? 'electron.exe' : 'electron')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'esb-pass2-'))
const DAY = 24 * 3600 * 1000
const now = Date.now()

// history: 2,000 events over 30 days + some today, mixed outcomes
const types = ['send.ok', 'send.ok', 'send.ok', 'send.skip', 'send.fail', 'reply', 'bounce']
const lines = []
for (let i = 0; i < 2000; i++) {
  const t = now - 30 * DAY + i * ((30 * DAY - 3600e3) / 2000)
  const type = types[i % types.length]
  lines.push({ id: `${t.toString(36)}-${i.toString(36)}-syn`, t, type, email: `p${i}@org${i % 40}.example.org`, name: `Person ${i}`, org: `Org ${i % 40}`, campaignId: 'old', jobId: 'old', run: 'first', ms: 800 + (i % 300), ...(type === 'send.fail' ? { kind: 'recipient_permanent', error: '550 5.1.1 user unknown' } : {}), ...(type === 'send.skip' ? { reason: 'cooldown' } : {}) })
}
const byMonth = {}
for (const e of lines) { const d = new Date(e.t); const k = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; (byMonth[k] ??= []).push(JSON.stringify(e)) }
for (const [k, ls] of Object.entries(byMonth)) fs.writeFileSync(path.join(profile, `outreach-events-${k}.jsonl`), ls.join('\n') + '\n')
fs.writeFileSync(path.join(profile, 'outreach-autopilot.json'), JSON.stringify({ window: { enabled: true, from: '00:00', to: '23:59', days: [0,1,2,3,4,5,6], tz: 'Asia/Dhaka' }, dailyLimit: 100, ramp: false, pace: 'manual', minDelaySec: 60, maxDelaySec: 120, domainMaxPerDay: 3, domainMinGapSec: 1200, contactCooldownDays: 30, traySending: true, aiAutonomy: 'confirm', aiReadsReply: false, autoResume: true, legacyBackfilled: true, pacingMigrated: true }))

const csvPath = path.join(profile, 'pass2-contacts.csv')
const rows = ['Serial,Person Name,Designation,Organization,Sector Group,Email,Phone,Purpose,Mail Server,Deliverability Status,Address']
for (let i = 0; i < 60; i++) rows.push(`${i + 1},Contact ${i + 1},Engineer,Org ${i % 8},Power,c${i}@org${i % 8}.example.org,,News,,SAFE_TO_SEND,Dhaka`)
fs.writeFileSync(csvPath, rows.join('\n'))

const app = await electron.launch({
  executablePath: exe,
  args: [...(win ? [] : ['--no-sandbox']), root, '--user-data-dir=' + profile],
  env: { ...process.env, ESB_OUTREACH_DRYRUN: '1', ESB_NO_SYNC: '1', ESB_OUTREACH_TRACKING: '0' },
})
const page = await app.firstWindow()
page.on('pageerror', (e) => console.log('PAGE ERROR', e.message))
const size = async (w, h) => { await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [w, h]); await page.waitForTimeout(350) }
const shot = async (name, loc) => { const f = path.join(out, `${name}.png`); await (loc ?? page).screenshot({ path: f }); console.log('shot', path.basename(f)) }
const toOutreach = async () => {
  await page.waitForSelector('.home-shell, .topbar', { timeout: 30000 })
  const tile = page.locator('.launch-tile:has-text("Outreach")')
  if (await tile.count()) await tile.first().click(); else await page.click('.ws-btn[data-ws="outreach"]')
  await page.waitForSelector('.outreach-workspace'); await page.waitForTimeout(600)
}
const theme = async (t) => { await page.evaluate((x) => localStorage.setItem('esb-banner-studio/theme', x), t); await page.reload(); await toOutreach() }

try {
  await size(1366, 820)
  await toOutreach()
  await page.evaluate(() => window.esb.outreachSave({ host: 'smtp.gmail.com', port: 587, user: 'desk@example.com', name: 'ESB Power Line', dailyLimit: 100, minDelaySec: 60, maxDelaySec: 120 }, 'abcd efgh ijkl mnop'))
  await page.setInputFiles('.outreach-workspace input[accept=".xlsx,.csv,.xls"] >> nth=0', csvPath)
  await page.waitForTimeout(1500)

  for (const t of ['dark', 'light']) {
    await theme(t)
    // pill-slide: shoot 80 ms after switching to Activity, then settled
    await page.click('.or-sb-autopilot'); await page.waitForTimeout(80); await shot(`pill-midflight-${t}`)
    await page.waitForSelector('.oa-desk'); await page.waitForTimeout(900); await shot(`activity-overview-${t}`)
    for (const tab of ['Reports', 'Session']) {
      await page.locator(`.oa-desk-tabs button:has-text("${tab}")`).first().click()
      await page.waitForTimeout(700); await shot(`activity-${tab.toLowerCase()}-${t}`)
    }
    // export menu open
    await page.locator('.oa-toolbar-right button:has-text("Export")').first().click()
    await page.waitForTimeout(400); await shot(`activity-export-menu-${t}`)
    await page.keyboard.press('Escape'); await page.waitForTimeout(200)
    // back to compose; right tabs
    await page.locator('.or-desk-seg button').first().click()
    await page.waitForSelector('.or-body'); await page.waitForTimeout(600)
    // select first contact then Contact tab
    const row = page.locator('.or-row').first()
    if (await row.count()) { await row.click(); await page.waitForTimeout(400) }
    await shot(`right-contact-${t}`)
    for (const tab of ['Review', 'Send']) {
      const b = page.locator(`.or-right .tabs button:has-text("${tab}"), .tabs button:has-text("${tab}")`)
      if (await b.count()) { await b.first().click(); await page.waitForTimeout(400); await shot(`right-${tab.toLowerCase()}-${t}`) }
    }
    // engine popover
    const eng = page.locator('button.sb-engine-btn')
    if (await eng.count()) { await eng.click(); await page.waitForTimeout(400); await shot(`engine-pop-${t}`); await page.keyboard.press('Escape'); await page.waitForTimeout(200) }
  }
} finally { await app.close() }
console.log('done →', out)
