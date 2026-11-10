// While a list or page scrolls, its content stops answering the pointer (`is-scrolling` on the scrolling element sets
// pointer-events: none on its children, inherited by everything inside). Rows sliding under a still pointer then cause no
// hover restyle or hit test per frame, so the compositor presents every scroll frame whole. Measured on the 2,000-row
// contact list (tools/audit/electron-scroll-trace.mjs): 30 of 120 frames presented partial with hover live, 1 without.
// The class drops 140 ms after the last scroll event, so the row under the pointer lights up as soon as it settles —
// and at once when the pointer really moves (a scroll then an immediate drag or click must land on what is under it;
// the browser's own hover re-checks after a scroll come at the same spot, so they stay calmed).
let el: HTMLElement | null = null
let timer = 0

export function installScrollCalm() {
  const settle = () => { el?.classList.remove('is-scrolling'); el = null }
  window.addEventListener('scroll', (e) => {
    const s = e.target
    if (!(s instanceof HTMLElement)) return
    if (s !== el) { el?.classList.remove('is-scrolling'); el = s; s.classList.add('is-scrolling') }
    window.clearTimeout(timer)
    timer = window.setTimeout(settle, 140)
  }, { capture: true, passive: true })
  let px = -1, py = -1
  window.addEventListener('pointermove', (e) => {
    const moved = e.clientX !== px || e.clientY !== py
    px = e.clientX; py = e.clientY
    if (el && moved) { window.clearTimeout(timer); settle() }
  }, { capture: true, passive: true })
  window.addEventListener('pointerdown', () => { if (el) { window.clearTimeout(timer); settle() } }, { capture: true, passive: true })
}
