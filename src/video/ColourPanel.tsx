// Inspector "Colour" section (Phase 2 — Part B): the basic correction sliders and a .cube 3D LUT with an intensity.
// The sliders edit one `colour` effect on the clip (made on the first move); the LUT is a `lut` effect that names its
// text by content id (effects.ts registerLut: the text is kept once per project, compacted and size-capped; the
// project's LUTs together have a budget, checked here at import). A file that is not a valid 3D .cube is refused with
// the parser's reason; nothing is stored.

import { useRef, useState } from 'react'
import { Icon } from '../ui/Icon'
import { IconButton } from '../ui/controls'
import type { Clip, ClipEffect } from './timeline'
import type { NumParam } from './effects'
import { EFFECT_DEFS, LUT_MAX_CHARS, LUT_MAX_FILE_BYTES, compactCube, lutBudgetProblem, lutOf, lutText as lutTextOf, lutsUsed, newEffect, paramValue, parseCube, registerLut, setParam } from './effects'
import { allClips } from './timeline'
import { useVideoStore } from './videoStore'
import { FxSection, ParamSlider } from './EffectsPanel'

const COLOUR_PARAMS = EFFECT_DEFS.colour.params as NumParam[]
const INTENSITY = EFFECT_DEFS.lut.params.find((p) => p.key === 'intensity') as NumParam

export function ColourPanel({ clip, onChange }: { clip: Clip; onChange: (c: Clip) => void }) {
  const all = clip.effects ?? []
  const colour = all.find((e) => e.type === 'colour')
  const lut = all.find((e) => e.type === 'lut')
  const fileRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')
  const [reading, setReading] = useState(false)
  const changed = colour ? COLOUR_PARAMS.filter((p) => paramValue(colour, p) !== p.def).length : 0

  const setColour = (key: string, v: number) => {
    if (colour) { onChange(setParam(clip, colour.id, key, v)); return }
    const e = newEffect('colour', all)
    onChange({ ...clip, effects: [...all, { ...e, params: { ...e.params, [key]: v } }] })
  }
  const resetColour = () => { if (colour) onChange({ ...clip, effects: all.filter((e) => e !== colour) }) }

  const loadLut = async (file: File) => {
    setError('')
    if (file.size > LUT_MAX_FILE_BYTES) { setError(`That file is ${Math.round(file.size / 1048576)} MB; a .cube LUT here may be at most ${LUT_MAX_FILE_BYTES / 1048576} MB.`); return }
    setReading(true)
    try {
      const r = parseCube(await file.text())
      if (!r.ok) { setError(r.error); return }
      const cube = compactCube(r.lut)
      if (cube.length > LUT_MAX_CHARS) { setError('This LUT is too big to keep in the project.'); return }
      const others = lutsUsed(allClips(useVideoStore.getState().project).filter((c) => c.id !== clip.id))
      const over = lutBudgetProblem(others, cube)
      if (over) { setError(over); return }
      const id = registerLut(cube)
      if (!id) { setError('This LUT could not be read.'); return }
      const name = (r.lut.title || file.name.replace(/\.cube$/i, '')).slice(0, 120)
      const { cube: _old, ...kept } = lut?.params ?? {}
      const next: ClipEffect = lut ? { ...lut, enabled: true, params: { ...kept, lut: id, name } } : { ...newEffect('lut', all), params: { lut: id, name, intensity: 1 } }
      onChange({ ...clip, effects: lut ? all.map((e) => (e === lut ? next : e)) : [...all, next] })
    } catch {
      setError('The file could not be read.')
    } finally {
      setReading(false)
    }
  }

  const lutText = (lut && lutTextOf(lutOf(lut))) || ''
  const lutSize = /LUT_3D_SIZE\s+(\d+)/.exec(lutText.slice(0, 400))?.[1]
  return (
    <FxSection id="colour" title="Colour" icon="palette" count={changed + (lutText ? 1 : 0)}>
      {COLOUR_PARAMS.map((p) => (
        <ParamSlider key={p.key} p={p} value={colour ? (paramValue(colour, p) as number) : p.def} onChange={(v) => setColour(p.key, v)} cls={`vw-s-fx-${p.key}`} />
      ))}
      {colour && <button type="button" className="btn sm vw-fx-reset" onClick={resetColour}><Icon name="reset" size={12} />Reset colour</button>}
      <div className="vw-subhead">LUT</div>
      {lutText ? (
        <div className="vw-fx-lut">
          <Icon name="palette" size={13} />
          <span className="vw-fx-lut-name" data-tip={String(lut?.params?.name ?? '')}>{String(lut?.params?.name || 'LUT')}</span>
          {lutSize && <span className="vw-fx-lut-size" data-tip={`A ${lutSize}×${lutSize}×${lutSize} colour table`}>{lutSize}-point cube</span>}
          <IconButton icon="trash" size={13} tip="Remove the LUT" className="vw-fx-remove" onClick={() => onChange({ ...clip, effects: all.filter((e) => e !== lut) })} />
        </div>
      ) : <p className="vw-hint">A 3D .cube file (17, 33 or 65 points), applied after the sliders.</p>}
      {lutText && lut && <ParamSlider p={INTENSITY} value={paramValue(lut, INTENSITY) as number} onChange={(v) => onChange(setParam(clip, lut.id, 'intensity', v))} cls="vw-s-fx-lut-intensity" />}
      <button type="button" className="btn sm vw-fx-load" disabled={reading} onClick={() => fileRef.current?.click()}><Icon name="upload" size={12} />{reading ? 'Reading…' : lutText ? 'Replace .cube' : 'Load .cube LUT'}</button>
      <input ref={fileRef} type="file" accept=".cube,text/plain" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void loadLut(f) }} />
      {error && <p className="vw-fx-error" role="alert"><Icon name="alert" size={12} />{error}</p>}
    </FxSection>
  )
}
