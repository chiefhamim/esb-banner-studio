// Every desk header puts its mode control (Desk/Insights, Compose/Activity, the Graphics format group) between two
// `.spacer`s. Equal spacers centre it between its NEIGHBOURS, so a long campaign chip on the left pushed it ~280 px
// right of the window's middle. This weighs the two spacers so the control sits on the header's true centre whenever
// the room allows, and slides toward the side with room (never overlapping, 12 px floor) when it does not.
const MIN = 12
const seen = new WeakSet<HTMLElement>()

function fit(h: HTMLElement) {
  const sp = [...h.children].filter((c) => c.classList.contains('spacer')) as HTMLElement[]
  if (sp.length !== 2) return
  const [a, b] = sp
  const free = a.offsetWidth + b.offsetWidth
  if (!h.offsetWidth || free <= 0) return
  const hr = h.getBoundingClientRect()
  const ar = a.getBoundingClientRect()
  const br = b.getBoundingClientRect()
  const leftContent = ar.left - hr.left
  const centre = br.left - ar.right // the control(s) between the spacers, with their gaps
  const want = hr.width / 2 - centre / 2 - leftContent
  // no room for the true centre: centre it between its neighbours (equal gaps read balanced; hugging one side does not)
  const left = want < MIN || want > free - MIN ? free / 2 : want
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
