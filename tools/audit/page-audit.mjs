// The accessibility audit of one settled page, shared by the Video screenshot harness (tools/e2e/video-shots.mjs, AUDIT=1) and
// the desktop-app tests (the Publish sheet). Contrast (WCAG AA), interactive targets under 24 px (and under the studio's 28 px
// as information), controls with no accessible name, and focusable controls with no visible focus indicator.
export async function auditPage(page) {
  return page.evaluate(() => {
    const out = { contrast: [], small: [], below28: [], noName: [], noFocus: [] }
    // scrolled out of (or cut by) a scrolling or clipping ancestor: not on screen even though its box is inside the window
    const clippedAway = (el) => {
      const r = el.getBoundingClientRect()
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const cs = getComputedStyle(p)
        if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue
        const pr = p.getBoundingClientRect()
        if (cx < pr.left || cx > pr.right || cy < pr.top || cy > pr.bottom) return true
      }
      return false
    }
    const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05 && !el.closest('[aria-hidden="true"], [inert], canvas') && !clippedAway(el) }
    const parse = (c) => {
      const q = c.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/)
      if (q) return [Number(q[1]) * 255, Number(q[2]) * 255, Number(q[3]) * 255, q[4] === undefined ? 1 : Number(q[4])]
      const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1] }
    const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
    const over = (fg, bg) => [fg[0] * fg[3] + bg[0] * (1 - fg[3]), fg[1] * fg[3] + bg[1] * (1 - fg[3]), fg[2] * fg[3] + bg[2] * (1 - fg[3])]
    // what is really behind the text: the elements under its centre (a sliding chip sits BESIDE the label, not above it)
    const bgAt = (el) => {
      const r = el.getBoundingClientRect()
      const under = document.elementsFromPoint(Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2)), Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2))).filter((e) => !el.contains(e) || e === el)
      const stack = []
      let opaque = false
      for (const e of under) {
        const cs = getComputedStyle(e)
        if (cs.backgroundImage && cs.backgroundImage !== 'none') return null
        const c = parse(cs.backgroundColor)
        if (c && c[3] > 0) { stack.push(c); if (c[3] >= 1) { opaque = true; break } }
      }
      if (!opaque) return bgOf(el)
      let base = [255, 255, 255]
      for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base)
      return base
    }
    const bgOf = (el) => {
      const stack = []
      for (let e = el; e; e = e.parentElement) {
        const cs = getComputedStyle(e)
        if (cs.backgroundImage && cs.backgroundImage !== 'none') return null // a picture or gradient: not measurable here
        const c = parse(cs.backgroundColor)
        if (c && c[3] > 0) { stack.push(c); if (c[3] >= 1) break }
      }
      let base = [255, 255, 255]
      for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base)
      return base
    }
    const label = (el) => (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || el.className || el.tagName).toString().replace(/\s+/g, ' ').trim().slice(0, 60)
    const pathOf = (el) => el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '')
    // 1. contrast of every element that carries its own text
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    const seen = new Set()
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement
      if (!el || seen.has(el) || !n.textContent.trim() || !vis(el) || /^(SCRIPT|STYLE|OPTION)$/.test(el.tagName)) continue
      seen.add(el)
      // text hidden behind something else (a sticky footer over a scrolled list) is not on screen there
      { const r = el.getBoundingClientRect(); const top = document.elementFromPoint(Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2)), Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2))); if (top && !el.contains(top) && !top.contains(el)) continue }
      if (el.closest(':disabled, [aria-disabled="true"], .disabled, [disabled], [aria-selected="true"], [aria-checked="true"], [aria-pressed="true"], .mi.sel, .mi.on, .menu-item.sel, .menu-item.on, .menu-item.current, .menu-item.active, .selected')) continue
      const cs = getComputedStyle(el)
      const fg = parse(cs.color); const bg = bgAt(el)
      if (!fg || !bg) continue
      const col = over(fg, bg)
      const a = lum(col), b = lum(bg)
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
      const px = parseFloat(cs.fontSize); const bold = Number(cs.fontWeight) >= 700
      const need = px >= 24 || (px >= 18.66 && bold) ? 3 : 4.5
      if (ratio < need - 0.01) out.contrast.push({ el: pathOf(el), text: n.textContent.trim().slice(0, 40), ratio: Math.round(ratio * 100) / 100, need, fg: cs.color, bg: 'rgb(' + bg.map(Math.round).join(',') + ')' })
    }
    // 2-4. interactive controls
    const sel = 'button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=radio], [role=checkbox], [role=menuitem], [role=switch], [tabindex]:not([tabindex="-1"])'
    for (const el of document.querySelectorAll(sel)) {
      if (!vis(el) || el.matches(':disabled, [aria-disabled="true"]')) continue
      if (el.closest('.vw-clip-block, .vw-fade-handle, .vw-kf, .vw-marker, .vw-resize, .vw-visually-hidden, canvas') || el.matches('[role=separator]')) continue
      if (el.matches('input[type=range], input[type=file], input[type=checkbox].vw-visually-hidden')) { /* sized by its label or native */ }
      const r = el.getBoundingClientRect()
      const isRange = el.matches('input[type=range]')
      // a toggle's invisible padding is part of its hit area (primitives.css .tgl.sm::before)
      const hit = el.matches('.tgl.sm') ? { w: r.width + 4, h: r.height + 8 } : el.matches('.vw-ml-dot') ? { w: r.width + 12, h: r.height + 12 } : { w: r.width, h: r.height }
      if (!isRange && !el.matches('input[type=checkbox], input[type=radio]')) {
        const item = { el: pathOf(el), name: label(el), w: Math.round(hit.w), h: Math.round(hit.h) }
        if (hit.w < 24 || hit.h < 24) out.small.push(item)
        else if (hit.w < 28 || hit.h < 28) out.below28.push(item)
      }
      const named = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title') || el.getAttribute('data-tip') || (el.textContent || '').trim() || (el.labels && el.labels.length) || el.getAttribute('placeholder') || el.closest('label')
      if (!named && !el.matches('[role=tab], [role=radio]')) out.noName.push({ el: pathOf(el), w: Math.round(r.width), h: Math.round(r.height) })
    }
    return out
  })
}

/** Focus each tab-reachable control and look for an indicator (an outline or a ring); returns those with none. */
export async function auditFocus(page) {
  return page.evaluate(() => {
    const none = []
    const sel = 'button:not(:disabled), a[href], input:not([type=hidden]):not(:disabled), select:not(:disabled), textarea:not(:disabled), [role=tab], [tabindex]:not([tabindex="-1"])'
    const els = [...document.querySelectorAll(sel)].filter((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !e.closest('canvas, [aria-hidden="true"], [inert], .vw-visually-hidden') }).slice(0, 80)
    for (const e of els) {
      e.focus({ preventScroll: true })
      if (document.activeElement !== e) continue
      const cs = getComputedStyle(e)
      const hasOutline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0
      const hasRing = cs.boxShadow && cs.boxShadow !== 'none'
      // :focus-visible only shows for keyboard focus; emulate by checking the rule exists through matches()
      const fv = e.matches(':focus-visible')
      if (fv && !hasOutline && !hasRing) none.push((e.getAttribute('aria-label') || e.textContent || e.className || e.tagName).toString().replace(/\s+/g, ' ').trim().slice(0, 50))
    }
    document.activeElement?.blur?.()
    return none
  })
}

