// Person matte for the "Remove background" effect: MediaPipe's selfie segmenter (local wasm + bundled model, nothing
// leaves the PC) turns a footage frame into a small 0..255 alpha picture, which the GL pass multiplies into the layer.
// The matte is computed from the exact frame the compositor is about to draw, so preview and export agree.

import { mediapipeModel, mediapipeWasmDir } from '../ai/mediapipeAssets'

export interface Matte { w: number; h: number; data: Uint8Array; /** Changes whenever the picture does (GL re-uploads on a new rev). */ rev: number }

type Segmenter = import('@mediapipe/tasks-vision').ImageSegmenter

const SIZE = 256 // the selfie model's own input size
let seg: Promise<{ segmenter: Segmenter; personIndex: number }> | null = null
let state: 'idle' | 'loading' | 'ready' | 'failed' = 'idle'
let failure = ''
let ready: { segmenter: Segmenter; personIndex: number } | null = null
let rev = 0

export const matteState = () => ({ state, failure })

/** Load the segmenter once. A failure is remembered (with its reason) until `retry`. */
export function loadPersonMatte(): Promise<void> {
  if (!seg) {
    state = 'loading'
    seg = (async () => {
      const { ImageSegmenter, FilesetResolver } = await import('@mediapipe/tasks-vision')
      const vision = await FilesetResolver.forVisionTasks(mediapipeWasmDir())
      const segmenter = await ImageSegmenter.createFromOptions(vision, {
        baseOptions: { modelAssetPath: mediapipeModel('selfie_segmenter.tflite'), delegate: 'CPU' },
        runningMode: 'IMAGE',
        outputConfidenceMasks: true,
        outputCategoryMask: false,
      })
      const labels = segmenter.getLabels()
      // the person's mask; a model with one mask is that mask
      let personIndex = labels.findIndex((l) => /person|foreground|selfie/i.test(l))
      if (personIndex < 0) personIndex = labels.length > 1 ? labels.length - 1 : 0
      return { segmenter, personIndex }
    })().then(
      (r) => { ready = r; state = 'ready'; return r },
      (e) => { state = 'failed'; failure = (e as Error).message || 'The background model could not be loaded.'; throw e },
    )
    seg.catch(() => { /* reported through matteState */ })
  }
  return seg.then(() => undefined)
}

export function retryPersonMatte() { seg = null; ready = null; state = 'idle'; failure = '' }

let canvas: HTMLCanvasElement | OffscreenCanvas | null = null
let ctx2d: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null
const frame = new Map<string, { key: string; matte: Matte }>()

/** The matte for `image` (a video frame, bitmap or canvas) — or null while the model is still loading. `slot` names the
 * layer, `key` the instant (a repeat call for the same instant returns the same matte without running the model again). */
export function personMatteFor(slot: string, key: string, image: CanvasImageSource): Matte | null {
  if (!ready) { void loadPersonMatte().catch(() => {}); return null }
  const hit = frame.get(slot)
  if (hit && hit.key === key) return hit.matte
  if (!canvas) {
    canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(SIZE, SIZE) : Object.assign(document.createElement('canvas'), { width: SIZE, height: SIZE })
    ctx2d = canvas.getContext('2d', { willReadFrequently: true }) as typeof ctx2d
  }
  if (!ctx2d) return null
  ctx2d.drawImage(image, 0, 0, SIZE, SIZE)
  const { segmenter, personIndex } = ready
  const result = segmenter.segment(canvas as HTMLCanvasElement)
  try {
    const mask = result.confidenceMasks?.[Math.min(personIndex, (result.confidenceMasks?.length ?? 1) - 1)]
    if (!mask) return null
    const f = mask.getAsFloat32Array()
    const data = new Uint8Array(f.length)
    for (let i = 0; i < f.length; i++) data[i] = Math.max(0, Math.min(255, Math.round(f[i] * 255)))
    const matte: Matte = { w: mask.width, h: mask.height, data, rev: ++rev }
    frame.set(slot, { key, matte })
    return matte
  } finally {
    result.close()
  }
}

export function dropMatte(slot: string) { frame.delete(slot) }

/** True when a footage clip on this timeline has an enabled Remove background effect. */
export function usesPersonMatte(project: { clips: { kind: string; effects?: { type?: string; enabled?: boolean }[] }[] }): boolean {
  return project.clips.some((c) => c.kind === 'video' && (c.effects ?? []).some((e) => e && e.type === 'personMatte' && e.enabled !== false))
}
