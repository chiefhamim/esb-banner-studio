import { chromium } from 'playwright-core'
import { launchBrowser } from './launch-browser.mjs'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const desktopDir = path.join(process.env.USERPROFILE || 'C:/Users/User', 'Desktop')

const toBase64 = (relPath) => {
  const full = path.join(root, relPath)
  if (!fs.existsSync(full)) return ''
  const ext = path.extname(full).slice(1)
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png'
  return `data:${mime};base64,${fs.readFileSync(full).toString('base64')}`
}

const logoData = toBase64('src/assets/images/esb-logo.png')

const simpleHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #f1f3f6;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    color: #1f2937;
    padding: 40px 16px;
    display: flex;
    justify-content: center;
  }
  .card {
    width: 600px;
    background: #ffffff;
    border-radius: 8px;
    border: 1px solid #e2e8f0;
    box-shadow: 0 4px 16px rgba(0,0,0,0.04);
    overflow: hidden;
  }
  
  /* Brand stripes */
  .stripes { display: flex; height: 4px; width: 100%; }
  .s-green { flex: 1; background: #1e9b4a; }
  .s-red { flex: 1; background: #e52d2d; }
  .s-orange { flex: 1; background: #ec8e3c; }

  /* Header */
  .header {
    padding: 24px 32px 18px;
    border-bottom: 1px solid #f1f5f9;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .logo { height: 34px; width: auto; }
  .date-badge {
    font-size: 12px;
    font-weight: 500;
    color: #64748b;
  }

  /* Body */
  .body {
    padding: 28px 32px 24px;
    font-size: 14.5px;
    line-height: 1.65;
    color: #334155;
  }
  .greeting {
    font-size: 15px;
    font-weight: 600;
    color: #0f172a;
    margin-bottom: 14px;
  }
  p { margin-bottom: 16px; }

  /* The 4 Core Points */
  .point-block {
    margin: 20px 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .point-item {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    padding: 12px 14px;
  }
  .point-num {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: #1e9b4a;
    color: #ffffff;
    font-size: 11px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    margin-top: 1px;
  }
  .point-text {
    font-size: 13.5px;
    line-height: 1.5;
    color: #334155;
  }
  .point-text b { color: #0f172a; }
  .point-text a { color: #1e9b4a; text-decoration: none; font-weight: 600; }
  .point-text a:hover { text-decoration: underline; }

  /* Social links row */
  .social-row {
    display: flex;
    gap: 8px;
    margin-top: 6px;
  }
  .social-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    background: #ffffff;
    border: 1px solid #cbd5e1;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 600;
    color: #334155;
    text-decoration: none;
  }
  .social-pill.fb { color: #1877f2; border-color: #cbd5e1; }
  .social-pill.yt { color: #ff0000; border-color: #cbd5e1; }

  /* Ad Callout */
  .ad-box {
    background: #f0fdf4;
    border: 1px solid #bbf7d0;
    border-radius: 6px;
    padding: 16px 18px;
    margin: 20px 0;
  }
  .ad-box h4 {
    font-size: 14px;
    font-weight: 700;
    color: #166534;
    margin-bottom: 6px;
  }
  .ad-box p {
    font-size: 13px;
    line-height: 1.55;
    color: #166534;
    margin-bottom: 0;
  }
  .ad-box ul {
    margin: 8px 0 0 16px;
    font-size: 12.5px;
    color: #15803d;
  }

  /* CTA */
  .action-line {
    margin: 20px 0 8px;
    font-size: 14px;
    line-height: 1.55;
    color: #1e293b;
  }
  .action-line b { color: #0f172a; }

  /* Sign-off */
  .signoff {
    margin-top: 22px;
    padding-top: 16px;
    border-top: 1px solid #f1f5f9;
    font-size: 13.5px;
    line-height: 1.5;
    color: #475569;
  }
  .signoff b { color: #0f172a; }

  /* Footer */
  .footer {
    background: #fffef2;
    padding: 14px 32px;
    border-top: 1px solid #f1f5f9;
    font-size: 11.5px;
    line-height: 1.6;
    color: #64748b;
  }
  .footer a { color: #1e9b4a; text-decoration: none; }

  /* Unsubscribe line under footer */
  .optout {
    padding: 12px 32px 18px;
    font-size: 11px;
    color: #94a3b8;
    background: #ffffff;
    text-align: center;
  }
</style>
</head>
<body>
<div class="card">
  <div class="stripes"><div class="s-green"></div><div class="s-red"></div><div class="s-orange"></div></div>
  <div class="header">
    <img src="${logoData}" class="logo" alt="ESB PowerLine">
    <div class="date-badge">Monthly Briefing</div>
  </div>

  <div class="body">
    <div class="greeting">Dear {name},</div>
    <p>Greetings from <b>ESB PowerLine</b>. We are reaching out with a brief update on our newsroom and upcoming publication:</p>

    <div class="point-block">
      <!-- 1. Site Promotion -->
      <div class="point-item">
        <div class="point-num">1</div>
        <div class="point-text">
          <b>Our Daily News & Portal:</b> We cover continuous daily reporting, energy sector policy, and technical analyses at <a href="https://esbpowerline.com">esbpowerline.com</a>.
        </div>
      </div>

      <!-- 2. Social Media -->
      <div class="point-item">
        <div class="point-num">2</div>
        <div class="point-text">
          <b>Follow Our Social Channels:</b> Stay connected with breaking energy news, interviews, and video coverage:
          <div class="social-row">
            <a href="https://www.facebook.com/esbpowerlineofficial" class="social-pill fb">
              <span>Facebook</span>
            </a>
            <a href="https://www.youtube.com/@esbplbd" class="social-pill yt">
              <span>YouTube</span>
            </a>
          </div>
        </div>
      </div>

      <!-- 3. Upcoming Monthly Magazine -->
      <div class="point-item">
        <div class="point-num">3</div>
        <div class="point-text">
          <b>Upcoming Monthly Magazine:</b> Our next print and digital edition features comprehensive reports on national power distribution, renewable transitions, and key infrastructure milestones. It is distributed directly to leadership across MPEMR, BERC, BPDB, utilities, and private energy firms.
        </div>
      </div>

      <!-- 4. Advertisement Pitch -->
      <div class="point-item">
        <div class="point-num">4</div>
        <div class="point-text">
          <b>Advertise in This Issue:</b> If {organization} would like to highlight your latest projects, products, or brand achievements, commercial advertising slots are open for booking:
          <div class="ad-box">
            <h4>Available Placements:</h4>
            <ul>
              <li>Back Cover & Inside Cover spreads (Premium full-color)</li>
              <li>Full-Page & Half-Page institutional advertisements</li>
              <li>Sponsored technical articles and project profiles</li>
            </ul>
          </div>
        </div>
      </div>
    </div>

    <div class="action-line">
      <b>Interested in partnering or reviewing our rate card?</b><br>
      Simply reply directly to this email, or call / WhatsApp our desk at <b>+88 01711 378733</b>. We will send our Media Kit with pricing right over.
    </div>

    <div class="signoff">
      With best regards,<br><br>
      <b>Farid Uddin Ahmed</b><br>
      Editor & Publisher<br>
      ESB PowerLine — Safe Energy Safe Nation
    </div>
  </div>

  <div class="footer">
    <b>ESB PowerLine — Express Broadcast and Communication Ltd.</b><br>
    House#36/1, Avenue#01, Block#A, Section#10, Mirpur, Pallabi, Dhaka-1216 · <a href="https://esbpowerline.com">esbpowerline.com</a>
  </div>
  <div class="stripes"><div class="s-green"></div><div class="s-red"></div><div class="s-orange"></div></div>

  <div class="optout">
    If you would rather not receive emails from ESB PowerLine, reply with "unsubscribe" and we will not write again.
  </div>
</div>
</body>
</html>`

async function main() {
  const browser = await launchBrowser(chromium)
  const page = await browser.newPage({
    viewport: { width: 720, height: 1100 },
    deviceScaleFactor: 2
  })

  const dest = path.join(desktopDir, 'ESB-Simple-Outreach-Template.png')
  await page.setContent(simpleHtml, { waitUntil: 'load' })
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: dest, fullPage: true })
  await browser.close()
  console.log('Saved:', dest)
}

main().catch(console.error)
