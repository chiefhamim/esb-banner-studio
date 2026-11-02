// Fade shapes and corner handles on an audio clip in the timeline. The shapes show the real fade (the curve the audio
// graph applies); the dots at the top corners are dragged sideways to set the fade length (one undo step per drag),
// a right-click on a dot picks the curve. Handles appear only when the audio engine can store fades (never decoration).

import { useState } from 'react'
import { ContextMenu } from '../ui/controls'
import type { Clip } from './timeline'
import type { Fade, FadeCurve } from './audioAdapter'
import { FADE_CURVES, FADE_MAX, capabilities, clipFadeIn, clipFadeOut, gestureEnd, gestureStart, writeClip } from './audioAdapter'
import { fadeGain } from './audio/fades'

/** Gain 0..1 at x (0..1) along a fade of a curve, as the audio graph applies it. */
const shape = (curve: FadeCurve, x: number) => fadeGain(curve, x)

/** SVG path of one fade region: the area ABOVE the gain curve (what the fade takes away). */
function fadePath(kind: 'in' | 'out', w: number, h: number, curve: FadeCurve): string {
  const n = 16
  const pts: string[] = []
  for (let i = 0; i <= n; i++) {
    const x = i / n
    const g = kind === 'in' ? shape(curve, x) : shape(curve, 1 - x)
    pts.push(`${(x * w).toFixed(1)},${((1 - g) * h).toFixed(1)}`)
  }
  // close along the top edge
  return kind === 'in' ? `M0,0 L${pts.join(' L')} L${w},0 Z` : `M0,0 L${pts.join(' L')} L${w},0 Z`
}

type Which = 'in' | 'out'
const fmtSec = (d: number) => `${Math.round(d * 100) / 100} s`
const curveLabel = (c: FadeCurve) => FADE_CURVES.find((x) => x.value === c)?.label ?? c
/** The dot sits this far in from the fade's end, so it clears the clip's trim handle at the edge. */
const DOT_PAD = 11

export function FadeHandles({ clip, zoom, locked }: { clip: Clip; zoom: number; locked: boolean }) {
  const caps = capabilities()
  const [menu, setMenu] = useState<{ x: number; y: number; which: Which } | null>(null)
  const fin = clipFadeIn(clip)
  const fout = clipFadeOut(clip)
  if (!caps.clip && fin.dur === 0 && fout.dur === 0) return null
  const W = clip.duration * zoom
  const wIn = Math.min(W, fin.dur * zoom)
  const wOut = Math.min(W, fout.dur * zoom)
  const editable = caps.clip && !locked && W >= 48

  const setFade = (which: Which, f: Fade) => {
    const other = which === 'in' ? fout : fin
    const dur = Math.max(0, Math.min(FADE_MAX, clip.duration - other.dur, Math.round(f.dur * 100) / 100))
    writeClip(clip.id, which === 'in' ? { fadeIn: { ...f, dur } } : { fadeOut: { ...f, dur } })
  }

  const down = (which: Which) => (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!editable || e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    const block = (e.currentTarget.closest('.vw-clip-block') as HTMLElement).getBoundingClientRect()
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    gestureStart()
    const cur = which === 'in' ? fin : fout
    const move = (ev: PointerEvent) => {
      const px = (which === 'in' ? ev.clientX - block.left : block.right - ev.clientX) - DOT_PAD
      setFade(which, { dur: px / zoom, curve: cur.curve })
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      gestureEnd()
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }

  const openMenu = (which: Which, el: HTMLElement) => { const r = el.getBoundingClientRect(); setMenu({ x: r.left + r.width / 2, y: r.bottom + 4, which }) }

  const key = (which: Which) => (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!editable) return
    if (e.key === 'Enter' || e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); e.stopPropagation(); openMenu(which, e.currentTarget); return }
    const cur = which === 'in' ? fin : fout
    const step = e.shiftKey ? 1 : 0.1
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault(); e.stopPropagation()
      const sign = (e.key === 'ArrowRight' ? 1 : -1) * (which === 'in' ? 1 : -1)
      setFade(which, { dur: cur.dur + sign * step, curve: cur.curve })
    }
  }

  const dot = (which: Which, f: Fade, wpx: number) => (
    <button
      type="button" key={which}
      className={`vw-fade-dot ${which}${f.dur > 0 ? ' set' : ''}${editable ? '' : ' off'}`}
      style={which === 'in' ? { left: `${DOT_PAD + wpx}px` } : { right: `${DOT_PAD + wpx}px` }}
      data-fade={which} data-tip={editable ? `Fade ${which} ${fmtSec(f.dur)} · ${curveLabel(f.curve)}. Drag to change; double-click or right-click for the curve` : `Fade ${which} ${fmtSec(f.dur)}`}
      aria-label={`Fade ${which} ${f.dur.toFixed(2)} seconds, ${curveLabel(f.curve)}`} aria-haspopup="menu"

      disabled={!editable}
      onPointerDown={down(which)}
      onKeyDown={key(which)}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => { e.stopPropagation(); if (editable) openMenu(which, e.currentTarget) }}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); if (editable) setMenu({ x: e.clientX, y: e.clientY, which }) }}
    ><i /></button>
  )

  return (
    <>
      {wIn > 1 && <svg className="vw-fade-shape in" width={wIn} height="100%" viewBox={`0 0 ${wIn} 100`} preserveAspectRatio="none" aria-hidden="true" data-curve={fin.curve}><path d={fadePath('in', wIn, 100, fin.curve)} /></svg>}
      {wOut > 1 && <svg className="vw-fade-shape out" width={wOut} height="100%" viewBox={`0 0 ${wOut} 100`} preserveAspectRatio="none" aria-hidden="true" data-curve={fout.curve}><path d={fadePath('out', wOut, 100, fout.curve)} /></svg>}
      {(editable || fin.dur > 0 || fout.dur > 0) && (
        <>
          {dot('in', fin, wIn)}
          {dot('out', fout, wOut)}
        </>
      )}
      {menu && (
        <ContextMenu
          x={menu.x} y={menu.y} onClose={() => setMenu(null)}
          items={[
            { heading: `Fade ${menu.which} curve` },
            ...FADE_CURVES.map((c) => ({ label: c.label, hint: c.hint, checked: (menu.which === 'in' ? fin : fout).curve === c.value, onClick: () => { const cur = menu.which === 'in' ? fin : fout; setFade(menu.which, { dur: cur.dur || 0.5, curve: c.value }) } })),
            { divider: true },
            { label: 'Remove fade', onClick: () => setFade(menu.which, { dur: 0, curve: (menu.which === 'in' ? fin : fout).curve }) },
          ]}
        />
      )}
    </>
  )
}
