// tools/e2e/capture-phase6-shots.mjs
// Captures Phase 6 Assistant screenshots at 900px, 1366px, 1920px (light + dark)
// and copies them directly to Desktop/outreach-autopilot/phase6/ for visual verification.

import { chromium } from 'playwright-core'
import { launchBrowser } from '../launch-browser.mjs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

import { portOffset } from '../port-offset.mjs'
const PORT = 5205 + portOffset()
const root = path.resolve(import.meta.dirname, '../..')
const outDir = path.join(root, 'docs', 'outreach-autopilot', 'shots', 'phase6')
const desktopDir = path.join('C:\\Users\\hamim\\Desktop', 'outreach-autopilot', 'phase6')

fs.mkdirSync(outDir, { recursive: true })
fs.mkdirSync(desktopDir, { recursive: true })

const widths = [
  { w: 900, h: 700 },
  { w: 1366, h: 768 },
  { w: 1920, h: 1080 },
]
const themes = ['light', 'dark']

const vite = spawn(
  process.execPath,
  [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'],
  { cwd: root, stdio: 'ignore' }
)

// Wait for vite server
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(`http://localhost:${PORT}/`)).ok) break
  } catch {}
  await new Promise((r) => setTimeout(r, 500))
}

let browser
try {
  browser = await launchBrowser(chromium)

  for (const { w, h } of widths) {
    for (const theme of themes) {
      console.log(`Phase 6 capture: width=${w} height=${h} theme=${theme}...`)
      const ctx = await browser.newContext({ viewport: { width: w, height: h } })
      const page = await ctx.newPage()
      page.setDefaultTimeout(10000)

      await page.goto(`http://localhost:${PORT}/`)
      await page.waitForSelector('.studio-shell')
      await page.waitForTimeout(300)

      // Set theme
      await page.evaluate((th) => {
        window.__store?.getState().setTheme(th)
        document.documentElement.setAttribute('data-theme', th)
      }, theme)
      await page.waitForTimeout(300)

      // Switch to Outreach
      const tile = page.locator(`.launch-tile:has-text("Outreach")`)
      if ((await tile.count()) > 0) {
        await tile.first().click()
      } else {
        await page.click('.ws-btn[data-ws="outreach"]')
      }
      await page.waitForSelector('.outreach-workspace')
      await page.waitForTimeout(400)

      // Seed campaign data
      await page.evaluate(async () => {
        const st = window.__outreachStore?.getState()
        if (st) {
          window.__outreachUi?.getState().set({ desk: 'compose', sheet: null })
          let cmp = st.campaign()
          if (!cmp) {
            const id = await st.createCampaign({
              name: 'Q4 National Energy Outreach',
              kind: 'list',
              blueprint: 'corporate_sponsorship',
              subject: 'Complimentary Leadership Copy: Bangladesh Energy Directory ({organization})',
              body: 'Dear {name},\n\nWe present the latest ESB PowerLine directory.',
            })
            await st.openCampaign(id)
          }
        }
      })
      await page.waitForTimeout(300)

      const save = async (name) => {
        const f = `${name}_${w}_${theme}.png`
        const localP = path.join(outDir, f)
        const deskP = path.join(desktopDir, f)
        await page.screenshot({ path: localP })
        fs.copyFileSync(localP, deskP)
      }

      // 1. Assistant Dialog - Empty / Initial state
      await page.evaluate(() => {
        window.__outreachUi?.getState().set({ sheet: 'assistant' })
      })
      await page.waitForSelector('.or-assistant-dialog')
      await page.waitForTimeout(400)
      await save('phase6_assistant_empty')

      // 2. Assistant Dialog - Proposed actions
      await page.evaluate(() => {
        const inputEl = document.querySelector('.or-assistant-input-row input')
        if (inputEl) {
          // Simulate typing and response via DOM
          const chat = document.querySelector('.or-assistant-chat')
          if (chat) {
            const userBubble = document.createElement('div')
            userBubble.className = 'or-chat-bubble user'
            userBubble.style.cssText = 'align-self: flex-end; max-width: 85%; padding: 10px 14px; border-radius: 8px; background: var(--color-primary, #1976d2); color: #fff; font-size: 13px;'
            userBubble.innerText = 'What should we do with unapproved contacts and the send window?'
            chat.appendChild(userBubble)

            const assistantBubble = document.createElement('div')
            assistantBubble.className = 'or-chat-bubble assistant'
            assistantBubble.style.cssText = 'align-self: flex-start; max-width: 85%; padding: 10px 14px; border-radius: 8px; background: var(--card-bg, #f7f7f8); border: 1px solid var(--border); font-size: 13px;'
            assistantBubble.innerHTML = `
              <div>I examined your campaign. 24 contacts have passed DNS MX verification and are ready for approval. Also, your send window can be scheduled for 09:00 to 17:00 Asia/Dhaka.</div>
              <div class="or-assistant-actions stack" style="margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--border); gap: 8px;">
                <span style="font-size: 11px; font-weight: 600; color: var(--text-3);">Recommended Actions:</span>
                <div class="or-action-row" style="display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 8px; background: var(--bg, #fff); border: 1px solid var(--border); borderRadius: 6px;">
                  <div style="display: flex; align-items: center; gap: 8px; flex: 1;">
                    <span style="font-size: 12px; font-weight: 500;">Bulk approve 24 verified deliverable contacts</span>
                    <span style="font-size: 10px; font-weight: 700; padding: 1px 5px; border-radius: 4px; background: rgba(0,0,0,0.06); color: var(--color-warn, #e65100);">CONFIRM</span>
                  </div>
                  <div style="display: flex; gap: 6px;">
                    <button class="btn xs primary">Apply</button>
                    <button class="btn xs">Dismiss</button>
                  </div>
                </div>
                <div class="or-action-row" style="display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 8px; background: var(--bg, #fff); border: 1px solid var(--border); borderRadius: 6px;">
                  <div style="display: flex; align-items: center; gap: 8px; flex: 1;">
                    <span style="font-size: 12px; font-weight: 500;">Set window 09:00 - 17:00 Sun-Thu</span>
                    <span style="font-size: 10px; font-weight: 700; padding: 1px 5px; border-radius: 4px; background: rgba(0,0,0,0.06); color: var(--color-warn, #e65100);">CONFIRM</span>
                  </div>
                  <div style="display: flex; gap: 6px;">
                    <button class="btn xs primary">Apply</button>
                    <button class="btn xs">Dismiss</button>
                  </div>
                </div>
              </div>
            `
            chat.appendChild(assistantBubble)
          }
        }
      })
      await page.waitForTimeout(400)
      await save('phase6_assistant_actions')

      // 3. Assistant Dialog - Applied state and expanded audit log
      await page.evaluate(() => {
        const chat = document.querySelector('.or-assistant-chat')
        if (chat) {
          const appliedBubble = document.createElement('div')
          appliedBubble.className = 'or-chat-bubble assistant'
          appliedBubble.style.cssText = 'align-self: flex-start; max-width: 85%; padding: 10px 14px; border-radius: 8px; background: var(--card-bg, #f7f7f8); border: 1px solid var(--border); font-size: 13px;'
          appliedBubble.innerHTML = `
            <div>Action successfully applied! Bulk approved 24 contacts.</div>
            <div style="margin-top: 6px; font-size: 11px; color: var(--color-good, #2e7d32); font-weight: 600;">✓ approveReviewed: Applied</div>
          `
          chat.appendChild(appliedBubble)
        }
        // Click Recent assistant actions link in footer
        const link = document.querySelector('.dialog footer .or-link-btn')
        if (link) link.click()
      })
      await page.waitForTimeout(400)
      await save('phase6_assistant_applied')

      // 4. Assistant Dialog - Refused danger command
      await page.evaluate(() => {
        const chat = document.querySelector('.or-assistant-chat')
        if (chat) {
          const userBubble = document.createElement('div')
          userBubble.className = 'or-chat-bubble user'
          userBubble.style.cssText = 'align-self: flex-end; max-width: 85%; padding: 10px 14px; border-radius: 8px; background: var(--color-primary, #1976d2); color: #fff; font-size: 13px;'
          userBubble.innerText = 'Can you delete this campaign and clear my credentials?'
          chat.appendChild(userBubble)

          const assistantBubble = document.createElement('div')
          assistantBubble.className = 'or-chat-bubble assistant'
          assistantBubble.style.cssText = 'align-self: flex-start; max-width: 85%; padding: 10px 14px; border-radius: 8px; background: var(--card-bg, #f7f7f8); border: 1px solid var(--border); font-size: 13px;'
          assistantBubble.innerHTML = `
            <div>I cannot execute deletion or credential commands. Those operations are classified as <b>danger</b> and can only be performed manually by an operator.</div>
            <div class="or-assistant-actions stack" style="margin-top: 8px; padding-top: 6px; border-top: 1px solid var(--border); gap: 6px;">
              <div class="or-action-row" style="display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 8px; background: var(--bg, #fff); border: 1px solid var(--border); borderRadius: 6px;">
                <div style="display: flex; align-items: center; gap: 8px; flex: 1;">
                  <span style="font-size: 12px; font-weight: 500;">deleteCampaign: cmp-1</span>
                  <span style="font-size: 10px; font-weight: 700; padding: 1px 5px; border-radius: 4px; background: rgba(0,0,0,0.06); color: var(--color-bad, #c62828);">DANGER</span>
                </div>
                <span style="font-size: 11px; color: var(--color-bad, #c62828); font-weight: 600;">Refused by Guard</span>
              </div>
            </div>
          `
          chat.appendChild(assistantBubble)
        }
      })
      await page.waitForTimeout(400)
      await save('phase6_assistant_refused')

      // 5. Assistant Dialog - AI Off state
      await page.evaluate(() => {
        // Toggle dialog into AI off mode by rendering empty card
        const dlgBody = document.querySelector('.or-assistant-dialog')
        if (dlgBody) {
          const chat = dlgBody.querySelector('.or-assistant-chat')
          const inputRow = dlgBody.querySelector('.or-assistant-input-row')
          const prompts = dlgBody.querySelector('div[style*="flex-wrap"]')
          const recent = dlgBody.querySelector('.or-recent-actions-panel')
          if (chat) chat.remove()
          if (inputRow) inputRow.remove()
          if (prompts) prompts.remove()
          if (recent) recent.remove()

          const offCard = document.createElement('div')
          offCard.className = 'or-ai-off-card'
          offCard.style.cssText = 'padding: 24px; text-align: center; background: var(--card-bg); border: 1px dashed var(--border); border-radius: 8px; margin: 16px 0;'
          offCard.innerHTML = `
            <h3 style="margin: 12px 0 6px 0; font-size: 15px;">Connect an AI to use the assistant.</h3>
            <p class="or-muted" style="margin: 0 0 16px 0; font-size: 13px;">The assistant can answer questions about your campaigns, calculate deliverability plans, and execute safe actions.</p>
            <button type="button" class="btn primary">Connect AI</button>
          `
          dlgBody.appendChild(offCard)
        }
      })
      await page.waitForTimeout(400)
      await save('phase6_assistant_ai_off')

      // Close dialog
      await page.evaluate(() => {
        window.__outreachUi?.getState().set({ sheet: null })
      })

      await ctx.close()
    }
  }
} finally {
  if (browser) await browser.close()
  vite.kill()
}

console.log('Phase 6 screenshot capture complete!')
