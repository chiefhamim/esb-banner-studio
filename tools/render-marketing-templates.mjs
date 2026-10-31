import { chromium } from 'playwright-core'
import { launchBrowser } from './launch-browser.mjs'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const desktopDir = path.join(process.env.USERPROFILE || 'C:/Users/User', 'Desktop')

// Helper to encode image to base64
const toBase64 = (relPath) => {
  const full = path.join(root, relPath)
  if (!fs.existsSync(full)) return ''
  const ext = path.extname(full).slice(1)
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png'
  return `data:${mime};base64,${fs.readFileSync(full).toString('base64')}`
}

const logoData = toBase64('src/assets/images/esb-logo.png')

// Template 1: The Executive Annual & Media Kit Showcase
const template1Html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #f4f5f8;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #1a1e24;
    padding: 40px 20px;
    display: flex;
    justify-content: center;
  }
  .wrapper {
    width: 660px;
    background: #ffffff;
    border-radius: 12px;
    overflow: hidden;
    box-shadow: 0 10px 30px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.04);
    border: 1px solid #e5e8ec;
  }
  .stripes {
    display: flex;
    height: 5px;
    width: 100%;
  }
  .stripe-green { flex: 1; background: #1e9b4a; }
  .stripe-red { flex: 1; background: #e52d2d; }
  .stripe-orange { flex: 1; background: #ec8e3c; }
  
  .header {
    padding: 28px 36px 20px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid #f0f2f5;
  }
  .logo { height: 38px; width: auto; }
  .issue-tag {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #1e9b4a;
    background: #eafaf1;
    padding: 5px 12px;
    border-radius: 20px;
    border: 1px solid #bbf0d2;
  }
  
  .hero {
    background: linear-gradient(135deg, #0e1e2d 0%, #17324d 100%);
    padding: 38px 36px;
    color: #ffffff;
  }
  .hero-kicker {
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #6ee7b7;
    margin-bottom: 10px;
  }
  .hero-title {
    font-size: 26px;
    line-height: 1.3;
    font-weight: 800;
    letter-spacing: -0.02em;
    margin-bottom: 14px;
  }
  .hero-sub {
    font-size: 15px;
    line-height: 1.55;
    color: #cbd5e1;
  }
  
  .stats-bar {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    background: #f8fafc;
    border-bottom: 1px solid #e2e8f0;
    padding: 18px 36px;
  }
  .stat-item {
    border-right: 1px solid #e2e8f0;
    padding: 0 16px;
    text-align: center;
  }
  .stat-item:first-child { padding-left: 0; text-align: left; }
  .stat-item:last-child { border-right: none; padding-right: 0; text-align: right; }
  .stat-num {
    font-size: 22px;
    font-weight: 800;
    color: #0f172a;
    letter-spacing: -0.01em;
  }
  .stat-label {
    font-size: 11.5px;
    font-weight: 500;
    color: #64748b;
    margin-top: 2px;
  }
  
  .content {
    padding: 34px 36px;
  }
  .greeting {
    font-size: 15px;
    font-weight: 600;
    color: #1e293b;
    margin-bottom: 14px;
  }
  .lead-text {
    font-size: 14.5px;
    line-height: 1.65;
    color: #334155;
    margin-bottom: 24px;
  }
  
  .section-h {
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #475569;
    margin-bottom: 14px;
  }
  
  .cards-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-bottom: 28px;
  }
  .ad-card {
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 16px;
    background: #f8fafc;
  }
  .ad-card.featured {
    border-color: #1e9b4a;
    background: #f0fdf4;
  }
  .ad-tag {
    display: inline-block;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    color: #1e9b4a;
    margin-bottom: 6px;
  }
  .ad-title {
    font-size: 14.5px;
    font-weight: 700;
    color: #0f172a;
    margin-bottom: 6px;
  }
  .ad-desc {
    font-size: 12.5px;
    line-height: 1.5;
    color: #475569;
  }
  
  .cta-section {
    background: #f1f5f9;
    border-radius: 10px;
    padding: 24px;
    text-align: center;
    margin-bottom: 28px;
    border: 1px solid #e2e8f0;
  }
  .cta-h {
    font-size: 16px;
    font-weight: 700;
    color: #0f172a;
    margin-bottom: 6px;
  }
  .cta-desc {
    font-size: 13px;
    color: #64748b;
    margin-bottom: 16px;
  }
  .btn-primary {
    display: inline-block;
    background: #1e9b4a;
    color: #ffffff;
    font-size: 14px;
    font-weight: 700;
    padding: 12px 28px;
    border-radius: 6px;
    text-decoration: none;
    box-shadow: 0 4px 14px rgba(30, 155, 74, 0.35);
  }
  
  .sender-info {
    font-size: 13.5px;
    line-height: 1.6;
    color: #334155;
    border-top: 1px solid #e2e8f0;
    padding-top: 22px;
  }
  .sender-name { font-weight: 700; color: #0f172a; }
  .sender-role { color: #64748b; font-size: 12.5px; }
  
  .footer-box {
    background: #fffef2;
    padding: 16px 36px;
    border-top: 1px solid #f1f5f9;
    font-size: 11.5px;
    line-height: 1.7;
    color: #64748b;
  }
  .footer-links a { color: #1e9b4a; text-decoration: none; font-weight: 500; }
  
  .optout {
    padding: 14px 36px 20px;
    font-size: 11px;
    line-height: 1.5;
    color: #94a3b8;
    background: #ffffff;
    text-align: center;
  }
</style>
</head>
<body>
<div class="wrapper">
  <div class="stripes"><div class="stripe-green"></div><div class="stripe-red"></div><div class="stripe-orange"></div></div>
  <div class="header">
    <img src="${logoData}" class="logo" alt="ESB PowerLine">
    <div class="issue-tag">Media Kit 2026–2027</div>
  </div>
  
  <div class="hero">
    <div class="hero-kicker">Special National Energy Supplement</div>
    <div class="hero-title">Put BREB Directly Before 50,000+ Energy & Infrastructure Decision-Makers</div>
    <div class="hero-sub">The definitive annual reference manual delivered straight to ministers, regulators (BERC), utility chiefs, and international financiers (World Bank, ADB, JICA).</div>
  </div>
  
  <div class="stats-bar">
    <div class="stat-item">
      <div class="stat-num">50,000+</div>
      <div class="stat-label">Executive Readership</div>
    </div>
    <div class="stat-item">
      <div class="stat-num">100%</div>
      <div class="stat-label">Ministry & Board Reach</div>
    </div>
    <div class="stat-item">
      <div class="stat-num">12 Mos</div>
      <div class="stat-label">Desk Shelf-Life</div>
    </div>
  </div>
  
  <div class="content">
    <div class="greeting">Dear Mr. Anjan Kanti Das,</div>
    <div class="lead-text">
      With BREB driving rural industrialization across 80 Palli Bidyut Samities and modernizing grid stability for over 35 million consumers, your institution has an extraordinary story of national progress. We are officially opening commercial partner bookings for our upcoming flagship edition.
    </div>
    
    <div class="section-h">Featured Commercial & Editorial Sponsorships</div>
    <div class="cards-grid">
      <div class="ad-card featured">
        <span class="ad-tag">High Impact · 2 Spreads Left</span>
        <div class="ad-title">Institutional Center Spread</div>
        <div class="ad-desc">Double-page full color showcase examining BREB’s smart metering, loss reduction, and PBS milestones.</div>
      </div>
      <div class="ad-card">
        <span class="ad-tag" style="color:#d97706">Premium Covers</span>
        <div class="ad-title">Back & Inside Covers</div>
        <div class="ad-desc">Exclusive front-and-back high-visibility placement received directly by energy ministry leadership.</div>
      </div>
      <div class="ad-card">
        <span class="ad-tag" style="color:#2563eb">Digital Omnichannel</span>
        <div class="ad-title">Top Web & Newsletter Ad</div>
        <div class="ad-desc">Prominent banner spotlight on esbpowerline.com and dedicated sponsored inclusion in executive digests.</div>
      </div>
      <div class="ad-card">
        <span class="ad-tag" style="color:#7c3aed">Archival Directory</span>
        <div class="ad-title">Annual Census Listing</div>
        <div class="ad-desc">Verified institutional profile in the National Energy Directory kept year-round on executive desks.</div>
      </div>
    </div>
    
    <div class="cta-section">
      <div class="cta-h">Reserve BREB’s Placement in the 2026 Edition</div>
      <div class="cta-desc">Download our complete 2026 Media Kit & Commercial Rate Card with full specs and deadlines.</div>
      <a href="https://esbpowerline.com" class="btn-primary">Download Media Kit & Rate Card (PDF) →</a>
    </div>
    
    <div class="sender-info">
      <p style="margin-bottom: 12px;">Premium covers and center spreads are confirmed on a first-come basis. Would you like our partnership desk to reserve a dedicated spread for BREB?</p>
      <div class="sender-name">Farid Uddin Ahmed</div>
      <div class="sender-role">Editor & Publisher · ESB PowerLine (Express Broadcast and Communication Ltd.)</div>
      <div class="sender-role">Direct: +88 01711 378733 · news@esbpowerline.com</div>
    </div>
  </div>
  
  <div class="footer-box">
    <div class="footer-links">
      <a href="https://esbpowerline.com">esbpowerline.com</a> · <a href="mailto:news@esbpowerline.com">news@esbpowerline.com</a> · Phone: +88 01711 378733<br>
      Address: House#36/1, Avenue#01, Block#A, Section#10, Mirpur, Pallabi, Dhaka-1216
    </div>
  </div>
  <div class="stripes"><div class="stripe-green"></div><div class="stripe-red"></div><div class="stripe-orange"></div></div>
  
  <div class="optout">
    If you would rather not receive promotional partner releases from ESB PowerLine, reply with "unsubscribe" and we will not write again.
  </div>
</div>
</body>
</html>`

// Template 2: The Milestone Spotlight & Editorial Feature
const template2Html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #0f172a;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #0f172a;
    padding: 40px 20px;
    display: flex;
    justify-content: center;
  }
  .wrapper {
    width: 660px;
    background: #ffffff;
    border-radius: 14px;
    overflow: hidden;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.4);
  }
  .stripes { display: flex; height: 5px; width: 100%; }
  .stripe-green { flex: 1; background: #1e9b4a; }
  .stripe-red { flex: 1; background: #e52d2d; }
  .stripe-orange { flex: 1; background: #ec8e3c; }

  .header {
    padding: 24px 34px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: #ffffff;
    border-bottom: 1px solid #f1f5f9;
  }
  .logo { height: 36px; }
  .status-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    font-weight: 600;
    color: #059669;
    background: #ecfdf5;
    padding: 4px 10px;
    border-radius: 999px;
  }
  .dot { width: 6px; height: 6px; border-radius: 50%; background: #10b981; }

  .hero-spotlight {
    background: #0b1329;
    padding: 38px 34px;
    color: #ffffff;
    border-bottom: 1px solid #1e293b;
    position: relative;
  }
  .hero-tag {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #38bdf8;
    margin-bottom: 8px;
  }
  .hero-heading {
    font-size: 24px;
    line-height: 1.35;
    font-weight: 800;
    letter-spacing: -0.01em;
    margin-bottom: 12px;
  }
  .hero-desc {
    font-size: 14.5px;
    line-height: 1.6;
    color: #94a3b8;
  }

  .magazine-preview {
    margin: 22px 0 0;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    padding: 16px 20px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .prev-title { font-size: 13px; font-weight: 600; color: #f8fafc; }
  .prev-sub { font-size: 11.5px; color: #64748b; margin-top: 2px; }
  .prev-badge {
    font-size: 11px;
    font-weight: 700;
    color: #38bdf8;
    background: rgba(56, 189, 248, 0.12);
    padding: 4px 10px;
    border-radius: 6px;
    border: 1px solid rgba(56, 189, 248, 0.25);
  }

  .body-content {
    padding: 34px;
    background: #ffffff;
  }
  .pitch-lead {
    font-size: 15px;
    line-height: 1.65;
    color: #1e293b;
    margin-bottom: 22px;
  }

  .feature-box {
    background: #f8fafc;
    border-left: 4px solid #1e9b4a;
    padding: 18px 20px;
    border-radius: 0 8px 8px 0;
    margin-bottom: 24px;
  }
  .feature-box h4 {
    font-size: 14px;
    font-weight: 700;
    color: #0f172a;
    margin-bottom: 6px;
  }
  .feature-box p {
    font-size: 13px;
    line-height: 1.55;
    color: #475569;
  }

  .benefits-list {
    margin: 20px 0 28px;
    list-style: none;
  }
  .benefit-item {
    display: flex;
    gap: 12px;
    margin-bottom: 14px;
    font-size: 13.5px;
    line-height: 1.5;
    color: #334155;
  }
  .check-icon {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #eafaf1;
    color: #1e9b4a;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 800;
    font-size: 12px;
    flex-shrink: 0;
    margin-top: 1px;
  }

  .cta-block {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #0f172a;
    border-radius: 10px;
    padding: 20px 24px;
    color: #ffffff;
  }
  .cta-text b { display: block; font-size: 15px; margin-bottom: 2px; }
  .cta-text span { font-size: 12px; color: #94a3b8; }
  .cta-button {
    background: #10b981;
    color: #ffffff;
    font-size: 13px;
    font-weight: 700;
    padding: 10px 20px;
    border-radius: 6px;
    text-decoration: none;
    white-space: nowrap;
  }

  .footer-sig {
    margin-top: 28px;
    padding-top: 20px;
    border-top: 1px solid #f1f5f9;
    font-size: 13.5px;
    color: #334155;
  }
  
  .footer-base {
    background: #fffef2;
    padding: 14px 34px;
    border-top: 1px solid #f1f5f9;
    font-size: 11.5px;
    line-height: 1.6;
    color: #64748b;
  }
  .optout {
    padding: 12px 34px 18px;
    font-size: 11px;
    color: #94a3b8;
    background: #ffffff;
    text-align: center;
  }
</style>
</head>
<body>
<div class="wrapper">
  <div class="stripes"><div class="stripe-green"></div><div class="stripe-red"></div><div class="stripe-orange"></div></div>
  <div class="header">
    <img src="${logoData}" class="logo" alt="ESB PowerLine">
    <div class="status-badge"><span class="dot"></span> Bookings Open: Issue #48</div>
  </div>

  <div class="hero-spotlight">
    <div class="hero-tag">Special Editorial Profile & Brand Feature</div>
    <div class="hero-heading">Showcase BREB’s Rural Modernization Before Bangladesh’s Energy Elite</div>
    <div class="hero-desc">Connecting your achievements directly with the Ministry of Power & Energy, BERC, BPDB, and international development financiers.</div>
    <div class="magazine-preview">
      <div>
        <div class="prev-title">National Energy Directory 2026–2027</div>
        <div class="prev-sub">Double-Page Institutional Spread · Full Color Retinal Print</div>
      </div>
      <div class="prev-badge">Prime Placement</div>
    </div>
  </div>

  <div class="body-content">
    <div class="pitch-lead">
      <b>Dear Anjan Kanti Das,</b><br><br>
      As Deputy Director of Public Relations for BREB, your team is overseeing one of the largest power distribution networks in Asia. As ESB PowerLine closes editorial curations for our upcoming National Energy Edition, we invite BREB to anchor our flagship distribution review.
    </div>

    <div class="feature-box">
      <h4>Why Advertise in ESB PowerLine?</h4>
      <p>Unlike general daily newspapers whose business pages are discarded after 24 hours, our specialized annual magazine and directory are retained year-round directly on the desks of regulators, secretaries, and global EPC contractors.</p>
    </div>

    <ul class="benefits-list">
      <li class="benefit-item">
        <span class="check-icon">✓</span>
        <div><b>Guaranteed High-Level Exposure:</b> Hand-delivered executive copies to MPEMR, BERC, SREDA, Power Cell, and multilateral partners (ADB, JICA, World Bank).</div>
      </li>
      <li class="benefit-item">
        <span class="check-icon">✓</span>
        <div><b>Authentic Storytelling:</b> High-craft technical advertorials written by senior energy journalists that highlight BREB's smart prepaid metering and loss-reduction records.</div>
      </li>
      <li class="benefit-item">
        <span class="check-icon">✓</span>
        <div><b>Omnichannel Amplification:</b> Simultaneous digital banner coverage across esbpowerline.com and dedicated social news feeds reaching 100,000+ industry professionals.</div>
      </li>
    </ul>

    <div class="cta-block">
      <div class="cta-text">
        <b>View Our 2026 Media Kit & Rate Card</b>
        <span>Available cover positions & advertorial spreads</span>
      </div>
      <a href="https://esbpowerline.com" class="cta-button">Download Rate Card →</a>
    </div>

    <div class="footer-sig">
      <p style="margin-bottom: 6px;">We would be glad to discuss tailored options with your PR team at your convenience.</p>
      <b>Farid Uddin Ahmed</b><br>
      <span style="color:#64748b;font-size:12.5px;">Editor & Publisher · ESB PowerLine · +88 01711 378733</span>
    </div>
  </div>

  <div class="footer-base">
    <b>ESB PowerLine — Express Broadcast and Communication Ltd.</b><br>
    House#36/1, Avenue#01, Block#A, Section#10, Mirpur, Pallabi, Dhaka-1216 · news@esbpowerline.com
  </div>
  <div class="stripes"><div class="stripe-green"></div><div class="stripe-red"></div><div class="stripe-orange"></div></div>

  <div class="optout">
    If you would rather not receive emails from ESB PowerLine, reply with "unsubscribe" and we will not write again.
  </div>
</div>
</body>
</html>`

// Template 3: The Modern Minimalist Executive Briefing
const template3Html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #e2e8f0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #1e293b;
    padding: 40px 20px;
    display: flex;
    justify-content: center;
  }
  .wrapper {
    width: 640px;
    background: #ffffff;
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 4px 20px rgba(0,0,0,0.05);
    border: 1px solid #cbd5e1;
  }
  .stripes { display: flex; height: 4px; width: 100%; }
  .stripe-green { flex: 1; background: #1e9b4a; }
  .stripe-red { flex: 1; background: #e52d2d; }
  .stripe-orange { flex: 1; background: #ec8e3c; }

  .header {
    padding: 24px 32px 18px;
    border-bottom: 1px solid #e2e8f0;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .logo { height: 34px; }
  .briefing-tag {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.05em;
    color: #475569;
    background: #f1f5f9;
    padding: 4px 8px;
    border-radius: 4px;
    text-transform: uppercase;
  }

  .content { padding: 32px; font-size: 14.5px; line-height: 1.65; color: #334155; }
  .kicker { font-size: 12px; font-weight: 700; color: #1e9b4a; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 6px; }
  h1 { font-size: 22px; line-height: 1.35; font-weight: 800; color: #0f172a; margin-bottom: 18px; letter-spacing: -0.01em; }
  p { margin-bottom: 16px; }

  .rate-table {
    width: 100%;
    border-collapse: collapse;
    margin: 22px 0;
    font-size: 13px;
  }
  .rate-table th {
    background: #f8fafc;
    color: #475569;
    font-weight: 700;
    text-align: left;
    padding: 10px 14px;
    border-top: 1px solid #e2e8f0;
    border-bottom: 1px solid #cbd5e1;
  }
  .rate-table td {
    padding: 12px 14px;
    border-bottom: 1px solid #f1f5f9;
    color: #1e293b;
  }
  .badge-hot {
    background: #fef2f2;
    color: #dc2626;
    font-size: 10px;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 4px;
    margin-left: 6px;
  }

  .highlight-card {
    background: #f0fdf4;
    border: 1px solid #bbf7d0;
    border-radius: 6px;
    padding: 16px;
    margin: 20px 0;
  }
  .highlight-card b { color: #15803d; }

  .btn {
    display: inline-block;
    background: #0f172a;
    color: #ffffff;
    font-size: 13.5px;
    font-weight: 600;
    padding: 12px 24px;
    border-radius: 6px;
    text-decoration: none;
    margin: 10px 0 20px;
  }

  .sig {
    margin-top: 24px;
    padding-top: 20px;
    border-top: 1px solid #f1f5f9;
    font-size: 13.5px;
    color: #475569;
  }

  .footer-base {
    background: #fffef2;
    padding: 14px 32px;
    border-top: 1px solid #f1f5f9;
    font-size: 11.5px;
    line-height: 1.6;
    color: #64748b;
  }
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
<div class="wrapper">
  <div class="stripes"><div class="stripe-green"></div><div class="stripe-red"></div><div class="stripe-orange"></div></div>
  <div class="header">
    <img src="${logoData}" class="logo" alt="ESB PowerLine">
    <div class="briefing-tag">Media & Partnership Briefing</div>
  </div>

  <div class="content">
    <div class="kicker">Commercial Opportunities · Q4 2026</div>
    <h1>2026–2027 Bangladesh National Energy Directory & Magazine</h1>

    <p>Dear <b>Anjan Kanti Das</b>,</p>

    <p>Bookings are now formally open for commercial advertising and institutional profiling in ESB PowerLine’s upcoming flagship print edition and digital census.</p>

    <p>With a verified executive circulation reaching the Ministry of Power, Energy & Mineral Resources (MPEMR), BERC, BPDB, PGCB, and private IPP consortiums, this annual publication provides unmatched institutional visibility for BREB.</p>

    <table class="rate-table">
      <thead>
        <tr>
          <th>Placement Type</th>
          <th>Format / Specs</th>
          <th>Availability</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><b>Back Cover (Full Color)</b><span class="badge-hot">1 Left</span></td>
          <td>210 × 297 mm (+3mm bleed)</td>
          <td><span style="color:#dc2626;font-weight:600;">Closing Soon</span></td>
        </tr>
        <tr>
          <td><b>Double-Page Spread</b></td>
          <td>420 × 297 mm Center Spread</td>
          <td>Available (2 confirmed)</td>
        </tr>
        <tr>
          <td><b>Institutional Profile & Advertorial</b></td>
          <td>2 Full Pages (Text + Photos)</td>
          <td>Open for Reservation</td>
        </tr>
        <tr>
          <td><b>Inside Front / Back Cover</b></td>
          <td>Full Page Premium Finish</td>
          <td>1 Remaining</td>
        </tr>
      </tbody>
    </table>

    <div class="highlight-card">
      <b>Editorial Alignment:</b> Our senior editors will work alongside your PR desk to ensure BREB’s rural grid modernizations, prepaid smart metering, and PBS milestones are presented with mathematical accuracy and broadcast-grade visual layout.
    </div>

    <a href="https://esbpowerline.com" class="btn">Review Full Media Kit & Rates (PDF) →</a>

    <div class="sig">
      <b>Farid Uddin Ahmed</b><br>
      Editor & Publisher · ESB PowerLine<br>
      Direct: +88 01711 378733 · news@esbpowerline.com
    </div>
  </div>

  <div class="footer-base">
    <b>ESB PowerLine — Safe Energy Safe Nation</b><br>
    House#36/1, Avenue#01, Block#A, Section#10, Mirpur, Pallabi, Dhaka-1216 · esbpowerline.com
  </div>
  <div class="stripes"><div class="stripe-green"></div><div class="stripe-red"></div><div class="stripe-orange"></div></div>

  <div class="optout">
    If you would rather not receive emails from ESB PowerLine, reply with "unsubscribe" and we will not write again.
  </div>
</div>
</body>
</html>`

async function main() {
  console.log('Launching browser to render templates...')
  const browser = await launchBrowser(chromium)
  const page = await browser.newPage({
    viewport: { width: 760, height: 1100 },
    deviceScaleFactor: 2 // 2x Retina resolution for razor-sharp text
  })

  const templates = [
    { name: 'ESB-Email-Template-1-Executive-Media-Kit.png', html: template1Html },
    { name: 'ESB-Email-Template-2-Milestone-Spotlight.png', html: template2Html },
    { name: 'ESB-Email-Template-3-Modern-Minimalist.png', html: template3Html },
  ]

  for (const t of templates) {
    const dest = path.join(desktopDir, t.name)
    console.log(`Rendering ${t.name}...`)
    await page.setContent(t.html, { waitUntil: 'load' })
    // Ensure all web fonts and images are rendered
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: dest, fullPage: true })
    console.log(`Saved: ${dest}`)
  }

  await browser.close()
  console.log('All 3 marketing templates saved to Desktop successfully!')
}

main().catch((err) => {
  console.error('Render failed:', err)
  process.exit(1)
})
