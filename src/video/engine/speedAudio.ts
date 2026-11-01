// A speed-changed clip's sound for a span of the timeline: the source window it needs (pcmSource.ts) through the
// stretcher (timeStretch.ts), with the clip's own mapping (animation.ts). One per clip per playback / export, so the
// grain chain joins across pieces.

import type { Clip } from '../timeline'
import { audioRateAt, preservePitch, sourceTimeAt } from './animation'
import type { PcmSource } from './pcmSource'
import { SpeedRenderer } from './timeStretch'

export class ClipSpeedAudio {
  readonly clip: Clip
  readonly pcm: PcmSource
  readonly outRate: number
  private renderer: SpeedRenderer | null = null
  constructor(clip: Clip, pcm: PcmSource, outRate: number) {
    this.clip = clip
    this.pcm = pcm
    this.outRate = outRate
  }

  /** Timeline seconds [a, b) of the clip's sound, at outRate, one Float32Array per channel (null: no sound). */
  async render(a: number, b: number): Promise<Float32Array[] | null> {
    if (!(await this.pcm.ready)) return null
    const c = this.clip
    this.renderer ??= new SpeedRenderer({ outRate: this.outRate, channels: this.pcm.channels, preservePitch: preservePitch(c), map: (t) => sourceTimeAt(c, t), rate: (t) => audioRateAt(c, t) })
    const n0 = Math.round((a - c.start) * this.outRate)
    const len = Math.max(0, Math.round((b - a) * this.outRate))
    if (!len) return null
    const rate = this.pcm.sampleRate
    const [lo, hi] = this.renderer.neededSource(n0, len, rate)
    const spanLo = (c.in || 0) * rate
    const spanHi = (c.out > (c.in || 0) ? c.out : (c.in || 0) + c.duration) * rate
    const w = await this.pcm.window(lo, hi, spanLo, spanHi)
    return this.renderer.render(w, n0, len)
  }
}
