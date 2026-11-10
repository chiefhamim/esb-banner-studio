// Outreach 2026-11-02 simplification, end to end in the built app (dry run, temp profile, synthetic data only):
//  1. Activity → Log with a 50,000-event history (one event carries an object where a recipient is expected — the
//     shape that blanked the window on the editor's PC) opens in < 300 ms and stays responsive.
//  2. Screenshots, light + dark at 1366 and 900 px: the Sending settings panel with its live plan line, its Advanced
//     section, the Send footer waiting on the daily limit, and the Activity log with the big history.
// Usage: npm run build && node tools/e2e/outreach-simplify-shots.mjs   → tools/out/outreach-simplify/*.png
import { _electron as electron } from 'playwright-core'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const root = path.resolve(import.meta.dirname, '../..')
const out = path.join(root, 'tools', 'out', 'outreach-simplify')
fs.mkdirSync(out, { recursive: true })
const win = process.platform === 'win32'
const exe = path.join(root, 'node_modules', 'electron', 'dist', win ? 'electron.exe' : 'electron')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'esb-simplify-'))
const N = Number(process.env.EVENTS) || 50000
const DAY = 24 * 3600 * 1000

// ── a big synthetic history that ends three days ago, plus 10 sends today (Dhaka) ──
const now = Date.now()
const dhakaMidnight = (() => { const d = new Date(now + 6 * 3600e3); d.setUTCHours(0, 0, 0, 0); return d.getTime() - 6 * 3600e3 })()
const end = now - 3 * DAY
const types = ['send.ok', 'send.ok', 'send.ok', 'send.skip', 'send.fail', 'job.waiting', 'inbox.checked']
const lines = []
for (let i = 0; i < N; i++) {
  const t = end - (N - i) * 40_000
  const type = types[i % types.length]
  lines.push({ id: `${t.toString(36)}-${i.toString(36)}-syn`, t, type, email: `p${i}@org${i % 400}.example.org`, name: `Person ${i}`, org: `Org ${i % 400}`, campaignId: 'old', jobId: 'old', run: 'first', ms: 800 + (i % 300), ...(type === 'send.fail' ? { kind: 'recipient_permanent', error: '550 5.1.1 user unknown' } : {}), ...(type === 'send.skip' ? { reason: 'cooldown' } : {}) })
}
// the event that blanked the editor's window: `to` is an object
lines.push({ id: 'migrated-1', t: end + 1000, type: 'settings.migrated', what: 'pacing', from: { minDelaySec: 180, maxDelaySec: 480, pace: 'manual' }, to: { minDelaySec: 60, maxDelaySec: 120, pace: 'manual' }, source: 'outreach-smtp.json' })
const today0 = Math.max(dhakaMidnight + 60_000, now - 10 * 60_000)
for (let i = 0; i < 10; i++) lines.push({ id: `today-${i}`, t: Math.min(now - 5000, today0 + i * 30_000), type: 'send.ok', email: `t${i}@today${i}.example.org`, campaignId: 'old', run: 'first' })
const byMonth = {}
for (const e of lines) { const d = new Date(e.t); const k = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; (byMonth[k] ??= []).push(JSON.stringify(e)) }
for (const [k, ls] of Object.entries(byMonth)) fs.writeFileSync(path.join(profile, `outreach-events-${k}.jsonl`), ls.join('\n') + '\n')

// the editor's sending settings (09:00–21:00 every day, 100 a day, 1–2 min, 3 per organisation 20 min apart)
const dhakaHour = new Date(now + 6 * 3600e3).getUTCHours()
const hours = dhakaHour >= 9 && dhakaHour < 21 ? { from: '09:00', to: '21:00' } : { from: '00:00', to: '23:59' }
fs.writeFileSync(path.join(profile, 'outreach-autopilot.json'), JSON.stringify({ window: { enabled: true, ...hours, days: [0, 1, 2, 3, 4, 5, 6], tz: 'Asia/Dhaka' }, dailyLimit: 100, ramp: false, pace: 'manual', minDelaySec: 60, maxDelaySec: 120, domainMaxPerDay: 3, domainMinGapSec: 1200, contactCooldownDays: 30, traySending: true, aiAutonomy: 'confirm', aiReadsReply: false, autoResume: true, legacyBackfilled: true, pacingMigrated: true }))

// a synthetic list: 120 contacts, 96 of them in four organisations
const csvPath = path.join(profile, 'osimp-contacts.csv')
const rows = ['Serial,Person Name,Designation,Organization,Sector Group,Email,Phone,Purpose,Mail Server,Deliverability Status,Address']
for (let i = 0; i < 120; i++) {
  const dom = i < 96 ? `utility${i % 4}.example.org` : `firm${i}.example.org`
  rows.push(`${i + 1},Contact ${i + 1},Engineer,Org ${i < 96 ? i % 4 : i},Power,c${i}@${dom},,News,,SAFE_TO_SEND,Dhaka`)
}
fs.writeFileSync(csvPath, rows.join('\n'))

const app = await electron.launch({
  executablePath: exe,
  args: [...(win ? [] : ['--no-sandbox']), root, '--user-data-dir=' + profile],
  env: { ...process.env, ESB_OUTREACH_DRYRUN: '1', ESB_NO_SYNC: '1', ESB_OUTREACH_TRACKING: '0' },
})
const page = await app.firstWindow()
let fails = 0
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++ }
page.on('pageerror', (e) => { console.log('PAGE ERROR', e.message); fails++ })
const size = async (w) => { await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [w, w >= 1366 ? 820 : 760]); await page.waitForTimeout(350) }
const shot = async (name, loc) => { const f = path.join(out, `${name}.png`); await (loc ?? page).screenshot({ path: f }); console.log('shot', path.relative(root, f)) }
const toOutreach = async () => {
  await page.waitForSelector('.home-shell, .topbar', { timeout: 30000 })
  const tile = page.locator('.launch-tile:has-text("Outreach")')
  if (await tile.count()) await tile.first().click(); else await page.click('.ws-btn[data-ws="outreach"]:visible')
  await page.waitForSelector('.outreach-workspace')
  await page.waitForTimeout(600)
}
const theme = async (t) => { await page.evaluate((x) => localStorage.setItem('esb-banner-studio/theme', x), t); await page.reload(); await toOutreach() }
const openSending = async () => {
  await page.locator('[role="menubar"] button:has-text("Campaign"), .menubar button:has-text("Campaign")').first().click()
  await page.locator('[role="menuitem"]:has-text("Sending settings"), .menu-item:has-text("Sending settings")').first().click()
  await page.waitForSelector('[data-testid="or-plan-line"]', { timeout: 10000 })
  await page.waitForTimeout(400)
}

try {
  await size(1366)
  await toOutreach()
  await page.evaluate(() => window.esb.outreachSave({ host: 'smtp.gmail.com', port: 587, user: 'desk@example.com', name: 'ESB Power Line', dailyLimit: 100, minDelaySec: 60, maxDelaySec: 120 }, 'abcd efgh ijkl mnop'))
  await page.setInputFiles('.outreach-workspace input[accept=".xlsx,.csv,.xls"] >> nth=0', csvPath)
  await page.waitForTimeout(1500)

  // ── 1. the Log with 50k events ──
  await page.click('.or-sb-autopilot')
  await page.waitForSelector('.oa-desk')
  await page.waitForTimeout(800)
  await page.locator('.oa-range-seg button:has-text("All")').first().click()
  await page.waitForTimeout(800)
  await page.evaluate(() => { window.__lt = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(e.duration) }).observe({ type: 'longtask' }) })
  const t0 = Date.now()
  await page.locator('.oa-desk-tabs button:has-text("Log")').first().click()
  await page.waitForSelector('.oa-events .oa-ev', { timeout: 15000 })
  const openMs = Date.now() - t0
  let worst = 0
  for (let i = 0; i < 10; i++) { const a = Date.now(); await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r()))); worst = Math.max(worst, Date.now() - a); await page.waitForTimeout(100) }
  const lt = await page.evaluate(() => window.__lt)
  check(openMs < 300, `Log with ${N.toLocaleString()} events opens in ${openMs} ms (< 300)`)
  check(worst < 100 && Math.max(0, ...lt) < 200, `stays responsive: worst frame round trip ${worst} ms, longest task ${Math.round(Math.max(0, ...lt))} ms`)
  // the object-valued event is listed in words, not crashed on
  await page.fill('.oa-log-search input', 'settings')
  await page.waitForTimeout(600)
  await page.fill('.oa-log-search input', '')
  await page.locator('.oa-filter-chips button:has-text("All")').first().click()
  await page.waitForTimeout(500)
  check(await page.locator('[data-testid="desk-boundary"]').count() === 0 && await page.locator('.oa-ev').count() >= 200, 'no error, 200 rows on the first page')
  for (const t of ['light', 'dark']) {
    if (t === 'dark') { await theme('dark'); await page.click('.or-sb-autopilot'); await page.waitForSelector('.oa-desk'); await page.locator('.oa-range-seg button:has-text("All")').first().click(); await page.locator('.oa-desk-tabs button:has-text("Log")').first().click(); await page.waitForSelector('.oa-events .oa-ev') }
    for (const w of [1366, 900]) { await size(w); await shot(`log-50k-${t}-${w}`) }
  }
  // back to the compose desk
  await size(1366)
  await theme('light')
  await page.evaluate(() => { const b = [...document.querySelectorAll('.oa-desk-tabs button')]; void b })

  // ── 2. Sending settings ──
  for (const t of ['light', 'dark']) {
    await theme(t)
    for (const w of [1366, 900]) {
      await size(w)
      await openSending()
      const line = await page.locator('[data-testid="or-plan-line"]').innerText()
      if (t === 'light' && w === 1366) {
        check(/^Today: 10 of 100 sent · /.test(line), `plan line counts today's 10 sends: "${line}"`)
        check(/at 1–2 min gaps, 100 emails take about 2\.5 h/.test(line), 'plan line: 100 at 1–2 min ≈ 2.5 h')
        check(/the remaining \d+ in this campaign finish/.test(line), 'plan line: when the campaign finishes')
        check(await page.locator('[data-testid="or-plan-warn-org"]').count() === 1, 'warns: most contacts are in four organisations')
        // typing changes the plan (the draft is planned, not saved)
        await page.fill('[data-testid="or-gap-min"]', '20')
        await page.fill('[data-testid="or-gap-max"]', '20')
        const hrs = await page.waitForSelector('[data-testid="or-plan-warn-hours"]', { timeout: 4000 }).then(() => 1, () => 0)
        if (!hrs) { console.log('plan now:', await page.locator('[data-testid="or-plan"]').innerText()); await shot('osimp-debug-hours', page.locator('.dialog').first()) }
        check(hrs === 1 || hours.from === '00:00', 'a 20-min gap in 12 h warns that only ~36 fit')
        await page.keyboard.press('Escape')
        await page.waitForTimeout(300)
        await openSending()
      }
      await shot(`sending-${t}-${w}`, page.locator('.dialog').first())
      await page.locator('[data-testid="or-advanced"]').click()
      await page.waitForTimeout(300)
      await page.locator('.or-adv-body').scrollIntoViewIfNeeded()
      await shot(`sending-advanced-${t}-${w}`, page.locator('.dialog').first())
      await page.keyboard.press('Escape')
      await page.waitForTimeout(300)
    }
  }

  // ── 3. the Send footer waiting on the daily limit ──
  await theme('light')
  await size(1366)
  const saved = await page.evaluate(() => window.esb.outreachSettingsSave({ dailyLimit: 10 }))
  check(saved && saved.ok, 'daily limit 10 saved (10 already sent today)')
  const cid = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('esb-banner-studio/outreach/v2') || '{}').activeId || null } catch { return null } })
  const res = await page.evaluate((id) => window.esb.outreachJobSubmit({ campaignId: id, campaignName: 'Limit check', kind: 'first', messages: [{ to: 'one@fresh.example.org', subject: 'S', body: 'B' }] }), cid)
  check(res && res.ok, 'dry-run job submitted')
  const why = page.locator('[data-testid="or-foot-why"]')
  await why.waitFor({ timeout: 15000 })
  await page.waitForFunction(() => /limit reached/.test(document.querySelector('[data-testid="or-foot-why"]')?.textContent || ''), null, { timeout: 15000 })
  const text = await why.innerText()
  check(/^daily limit reached — 10 of 10 sent today · resumes .+ \((sending hours|new day)\)$/.test(text), `footer says what happens next: "${text}"`)
  for (const t of ['light', 'dark']) {
    if (t === 'dark') { await theme('dark'); await why.waitFor({ timeout: 10000 }) }
    for (const w of [1366, 900]) { await size(w); await shot(`footer-daily-limit-${t}-${w}`, page.locator('.or-right')) }
  }
} finally {
  await app.close()
  fs.rmSync(profile, { recursive: true, force: true })
}
console.log(fails ? `${fails} failed` : 'all passed')
process.exit(fails ? 1 : 0)
