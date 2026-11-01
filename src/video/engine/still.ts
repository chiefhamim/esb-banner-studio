// One preview frame at full project size, with every footage layer decoded exactly (full-size decoders over the
// preview URLs, the same render path as the monitor). The golden-frame test compares this with the exported file's frame.

import type { VideoProject } from '../timeline'
import { layersAt } from '../timeline'
import { picturesReady } from '../compositor'
import { GLCompositor } from './glCompositor'
import { FrameCache } from './frameCache'
import { SourceDecoder } from './decoder'
import { previewUrl } from './mediaSource'
import type { FrameInput } from './render'
import { renderFrame, srcTime } from './render'

export async function renderPreviewStill(project: VideoProject, t: number, w = project.width, h = project.height): Promise<{ pixels: Uint8ClampedArray; width: number; height: number }> {
  // its own full-size decoders (the monitor's are scaled to the monitor) over the same preview URLs
  const cache = new FrameCache(1024 * 1024 * 1024)
  const decoders = new Map<string, SourceDecoder>()
  const frames = new Map<string, FrameInput>()
  const clips = layersAt(project, t).flatMap((l) => (l.mix ? [l.mix.from, l.clip] : [l.clip])).filter((c) => c.kind === 'video' && !c.still && c.sourceUrl)
  await picturesReady(project.clips.filter((c) => c.sourceUrl && (c.still || c.kind === 'overlay')).map((c) => c.sourceUrl!))
  for (const c of clips) {
    const url = previewUrl(c)
    if (!url) continue
    let dec = decoders.get(url)
    if (!dec) { dec = new SourceDecoder(url, cache, 0); decoders.set(url, dec) }
    await dec.ready
    const e = await dec.exact(srcTime(c, t))
    if (e) frames.set(c.id, { image: e.image, width: e.width, height: e.height })
  }
  const canvas = new OffscreenCanvas(w, h)
  let comp: GLCompositor | null = null
  try {
    comp = new GLCompositor(canvas)
    renderFrame(comp, project, t, w, h, { frames: (c) => frames.get(c.id) ?? null })
    return { pixels: comp.read(), width: w, height: h }
  } finally {
    comp?.dispose()
    comp?.gl.getExtension('WEBGL_lose_context')?.loseContext()
    for (const d of decoders.values()) d.dispose()
    cache.clear()
  }
}
