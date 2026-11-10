// While a list or page scrolls, its content stops answering the pointer (`is-scrolling` on the scrolling element sets
// pointer-events: none on its children, inherited by everything inside). Rows sliding under a still pointer then cause no
// hover restyle or hit test per frame, so the compositor presents every scroll frame whole. Measured on the 2,000-row
// contact list (tools/audit/electron-scroll-trace.mjs): 30 of 120 frames presented partial with hover live, 1 without.
// The class drops 140 ms after the last scroll event, so the row under the pointer lights up as soon as it settles.
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
}
