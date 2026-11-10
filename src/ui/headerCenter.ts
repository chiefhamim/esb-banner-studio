// Every desk header puts its mode control (Desk/Insights, Compose/Activity, the Graphics format group) between two
// `.spacer`s. Equal spacers centre it between its NEIGHBOURS, so a long campaign chip on the left pushed it ~280 px
// right of the window's middle. This weighs the two spacers so the control sits on the header's true centre whenever
// the room allows, and slides toward the side with room (never overlapping, 12 px floor) when it does not.
const MIN = 12
const seen = new WeakSet<HTMLElement>()

// the open-item chip's name (campaign, story) may give up width so the control can reach the true centre; it keeps at
// least this much and ends in "…" (its tooltip has the whole name)
const NAME_MIN = 96

function fit(h: HTMLElement) {
  const sp = [...h.children].filter((c) => c.classList.contains('spacer')) as HTMLElement[]
  if (sp.length !== 2) return
  const [a, b] = sp
  const chip = h.querySelector<HTMLElement>(':scope > .or-camp-chip:not(.ed-story-chip)')
  const name = chip?.querySelector<HTMLElement>('.or-camp-name')
  // measure from the full chip every time (the window may have grown)
  if (chip?.classList.contains('hc-away')) chip.classList.remove('hc-away')
  if (name?.style.maxWidth) name.style.maxWidth = ''
  if (chip && name) {
    const want0 = need(h, a, b)
    if (want0 < MIN) {
      const w = name.getBoundingClientRect().width
      const short = MIN - want0
      // the name gives up width down to NAME_MIN; if that is still not enough the chip steps aside (the campaign is
      // named in the right column and the Campaigns tab), so the mode control always sits on the window's centre
      if (w - short >= NAME_MIN) name.style.maxWidth = Math.floor(w - short) + 'px'
      else chip.classList.add('hc-away')
    }
  }
  place(h, a, b)
  // a shortened name fades out at its end (the app shows no "…")
  h.querySelectorAll<HTMLElement>('.or-camp-name').forEach((n) => n.classList.toggle('is-cut', n.scrollWidth > n.clientWidth + 1))
}

/** How wide the left spacer must be for the control between the spacers to sit on the header's centre. */
function need(h: HTMLElement, a: HTMLElement, b: HTMLElement) {
  const hr = h.getBoundingClientRect()
  const ar = a.getBoundingClientRect()
  const br = b.getBoundingClientRect()
  return hr.width / 2 - (br.left - ar.right) / 2 - (ar.left - hr.left)
}

function place(h: HTMLElement, a: HTMLElement, b: HTMLElement) {
  const free = a.offsetWidth + b.offsetWidth
  if (!h.offsetWidth || free <= 0) return
  const hr = h.getBoundingClientRect()
  const ar = a.getBoundingClientRect()
  const br = b.getBoundingClientRect()
  const leftContent = ar.left - hr.left
  const centre = br.left - ar.right // the control(s) between the spacers, with their gaps
  const want = hr.width / 2 - centre / 2 - leftContent
  // no room for the true centre: as close to it as the neighbours allow (never nearer them than 12 px)
  const left = free < 2 * MIN ? free / 2 : Math.max(MIN, Math.min(free - MIN, want))
  const ga = Math.round(left * 10) / 10, gb = Math.round((free - left) * 10) / 10
  if (a.style.flexGrow === String(ga) && b.style.flexGrow === String(gb)) return
  a.style.flex = `${ga} 1 0px`
  b.style.flex = `${gb} 1 0px`
}

function watch(h: HTMLElement) {
  if (seen.has(h)) return
  seen.add(h)
  let raf = 0
  const kick = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; fit(h) }) }
  const ro = new ResizeObserver(kick)
  const observeKids = () => { ro.disconnect(); ro.observe(h); for (const c of h.children) if (!c.classList.contains('spacer')) ro.observe(c) }
  observeKids()
  new MutationObserver(() => { observeKids(); kick() }).observe(h, { childList: true })
  kick()
}

let installed = false
export function installHeaderCentering() {
  if (installed || typeof ResizeObserver === 'undefined') return
  installed = true
  const scan = () => document.querySelectorAll<HTMLElement>('header.topbar, header.ed-head').forEach(watch)
  let raf = 0
  new MutationObserver(() => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; scan() }) })
    .observe(document.body, { childList: true, subtree: true })
  scan()
}
