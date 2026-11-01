// WebGL2 compositor: every layer is a textured quad drawn in order over black, premultiplied alpha. The monitor and
// the export each own one (one per canvas); the drawing itself (render.ts) is shared, so a preview frame and an export
// frame are made the same way.
//
//   layer pass   one texture, a quad (transform: position, scale, rotation around an anchor), a crop (UV), opacity
//   mix pass     two inputs: the outgoing and incoming footage are each drawn into their own framebuffer, then mixed
//                by the crossfade's progress in one shader and laid over what is below
//
// Text and graphics come in as Canvas 2D rasters, uploaded once per change and kept by content key (texture LRU).
// Without WebGL2 the constructor throws GLUnavailableError: the caller shows that, never a wrong frame.

import type { Quad, UV } from './layerMath'
import { vertices } from './layerMath'

export class GLUnavailableError extends Error {
  constructor(why = 'WebGL2 is not available') { super(`${why}: the Video desk needs WebGL2 to draw the picture (check the graphics driver, or turn hardware acceleration on).`); this.name = 'GLUnavailableError' }
}

const VS = `#version 300 es
in vec2 aPos;
in vec2 aUv;
uniform vec2 uRes;
out vec2 vUv;
void main() {
  vUv = aUv;
  vec2 c = aPos / uRes * 2.0 - 1.0;
  gl_Position = vec4(c.x, -c.y, 0.0, 1.0);
}`

const FS_LAYER = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform float uAlpha;
out vec4 o;
void main() { o = texture(uTex, vUv) * uAlpha; }`

// full-frame pass over two framebuffers (rendered with the same projection, so uv = clip position)
const VS_FULL = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`

const FS_MIX = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uA;
uniform sampler2D uB;
uniform float uP;
out vec4 o;
void main() { o = mix(texture(uA, vUv), texture(uB, vUv), uP); }`

export interface TexHandle { tex: WebGLTexture; width: number; height: number }
interface CachedTex extends TexHandle { key: string; bytes: number }

/** What a layer draw needs: its texture and where it lands. */
export interface LayerDraw { tex: TexHandle; quad: Quad; uv: UV; alpha: number }

export class GLCompositor {
  readonly gl: WebGL2RenderingContext
  width = 0
  height = 0
  lost = false
  private layerProg: WebGLProgram
  private mixProg: WebGLProgram
  private vao: WebGLVertexArrayObject
  private vbo: WebGLBuffer
  private fullVao: WebGLVertexArrayObject
  private uLayer: { res: WebGLUniformLocation | null; tex: WebGLUniformLocation | null; alpha: WebGLUniformLocation | null }
  private uMix: { a: WebGLUniformLocation | null; b: WebGLUniformLocation | null; p: WebGLUniformLocation | null }
  private fbos: { fb: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number }[] = []
  /** Per-slot textures for moving pictures (a footage clip): re-uploaded only when its source object changes. */
  private slots = new Map<string, TexHandle & { src: unknown }>()
  /** Static rasters (titles, pictures, the bug) by content key, LRU. */
  private statics = new Map<string, CachedTex>()
  private staticBytes = 0
  staticBudget = 192 * 1024 * 1024
  uploads = 0

  static supported(): boolean {
    try {
      const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas')
      const gl = c.getContext('webgl2') as WebGL2RenderingContext | null
      const ok = !!gl
      gl?.getExtension('WEBGL_lose_context')?.loseContext()
      return ok
    } catch {
      return false
    }
  }

  readonly canvas: HTMLCanvasElement | OffscreenCanvas
  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    this.canvas = canvas
    const gl = canvas.getContext('webgl2', { alpha: false, premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' }) as WebGL2RenderingContext | null
    if (!gl) throw new GLUnavailableError()
    this.gl = gl
    if ('addEventListener' in canvas) {
      canvas.addEventListener('webglcontextlost', ((e: Event) => { e.preventDefault(); this.lost = true }) as EventListener)
    }
    this.layerProg = program(gl, VS, FS_LAYER)
    this.mixProg = program(gl, VS_FULL, FS_MIX)
    this.uLayer = { res: gl.getUniformLocation(this.layerProg, 'uRes'), tex: gl.getUniformLocation(this.layerProg, 'uTex'), alpha: gl.getUniformLocation(this.layerProg, 'uAlpha') }
    this.uMix = { a: gl.getUniformLocation(this.mixProg, 'uA'), b: gl.getUniformLocation(this.mixProg, 'uB'), p: gl.getUniformLocation(this.mixProg, 'uP') }

    this.vao = gl.createVertexArray()!
    this.vbo = gl.createBuffer()!
    gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo)
    gl.bufferData(gl.ARRAY_BUFFER, 16 * 4, gl.DYNAMIC_DRAW)
    const aPos = gl.getAttribLocation(this.layerProg, 'aPos')
    const aUv = gl.getAttribLocation(this.layerProg, 'aUv')
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0)
    gl.enableVertexAttribArray(aUv)
    gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 16, 8)

    this.fullVao = gl.createVertexArray()!
    gl.bindVertexArray(this.fullVao)
    const fb = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, fb)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW)
    const fPos = gl.getAttribLocation(this.mixProg, 'aPos')
    gl.enableVertexAttribArray(fPos)
    gl.vertexAttribPointer(fPos, 2, gl.FLOAT, false, 8, 0)
    gl.bindVertexArray(null)

    gl.disable(gl.DEPTH_TEST)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
  }

  /** Size the drawing buffer (device pixels) and start a frame: black. */
  begin(w: number, h: number) {
    const gl = this.gl
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h }
    this.width = w
    this.height = h
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, w, h)
    gl.clearColor(0, 0, 0, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
  }

  private newTexture(): WebGLTexture {
    const gl = this.gl
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return tex
  }

  private upload(tex: WebGLTexture, src: TexImageSource) {
    const gl = this.gl
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src)
    this.uploads++
  }

  /** The texture of a moving picture in `slot` (a clip id); uploaded only when `src` is a different object than last
   * time, or always when `always` (a <video> element, whose picture changes under the same object). */
  slotTexture(slot: string, src: TexImageSource, width: number, height: number, always = false): TexHandle {
    let s = this.slots.get(slot)
    if (!s) { s = { tex: this.newTexture(), width, height, src: null }; this.slots.set(slot, s) }
    if (always || s.src !== src) { this.upload(s.tex, src); s.src = src; s.width = width; s.height = height }
    return s
  }

  /** Drop slot textures not in `keep` (clips that left the screen). */
  pruneSlots(keep: Set<string>) {
    for (const [k, s] of this.slots) if (!keep.has(k)) { this.gl.deleteTexture(s.tex); this.slots.delete(k) }
  }

  /** A static texture by content key, made (rasterised and uploaded) only when it is not cached. */
  staticTexture(key: string, make: () => { src: TexImageSource; width: number; height: number } | null): TexHandle | null {
    const hit = this.statics.get(key)
    if (hit) { this.statics.delete(key); this.statics.set(key, hit); return hit }
    const m = make()
    if (!m) return null
    const tex = this.newTexture()
    this.upload(tex, m.src)
    const e: CachedTex = { key, tex, width: m.width, height: m.height, bytes: m.width * m.height * 4 }
    this.statics.set(key, e)
    this.staticBytes += e.bytes
    for (const [k, v] of this.statics) {
      if (this.staticBytes <= this.staticBudget || k === key) break
      this.gl.deleteTexture(v.tex)
      this.statics.delete(k)
      this.staticBytes -= v.bytes
    }
    return e
  }

  get staticCount() { return this.statics.size }

  /** One layer over what is drawn. */
  draw(d: LayerDraw) {
    if (d.alpha <= 0) return
    const gl = this.gl
    gl.useProgram(this.layerProg)
    gl.uniform2f(this.uLayer.res, this.width, this.height)
    gl.uniform1f(this.uLayer.alpha, Math.min(1, d.alpha))
    gl.uniform1i(this.uLayer.tex, 0)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, d.tex.tex)
    gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertices(d.quad, d.uv))
    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4)
  }

  private fbo(i: number) {
    const gl = this.gl
    let f = this.fbos[i]
    if (!f || f.w !== this.width || f.h !== this.height) {
      if (f) { gl.deleteFramebuffer(f.fb); gl.deleteTexture(f.tex) }
      const tex = this.newTexture()
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.width, this.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      const fb = gl.createFramebuffer()!
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
      f = { fb, tex, w: this.width, h: this.height }
      this.fbos[i] = f
    }
    return f
  }

  /** A two-input crossfade: `a` and `b` each drawn alone into a framebuffer, then mixed by `progress` over what is
   * drawn (premultiplied, so a part of `b` with no picture — fit bars — shows `a` fading out over the layers below). */
  mix(a: LayerDraw | null, b: LayerDraw, progress: number) {
    const gl = this.gl
    const fa = this.fbo(0)
    const fb = this.fbo(1)
    for (const [f, d] of [[fa, a], [fb, b]] as const) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, f.fb)
      gl.viewport(0, 0, this.width, this.height)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      if (d) this.draw(d)
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, this.width, this.height)
    gl.useProgram(this.mixProg)
    gl.uniform1f(this.uMix.p, Math.min(1, Math.max(0, progress)))
    gl.uniform1i(this.uMix.a, 0)
    gl.uniform1i(this.uMix.b, 1)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, fa.tex)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, fb.tex)
    gl.bindVertexArray(this.fullVao)
    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4)
    gl.activeTexture(gl.TEXTURE0)
  }

  /** RGBA pixels of the drawn frame, top row first (tests, golden frames). */
  read(): Uint8ClampedArray {
    const gl = this.gl
    const w = this.width
    const h = this.height
    const buf = new Uint8Array(w * h * 4)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf)
    const out = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++) out.set(buf.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4)
    return out
  }

  dispose() {
    const gl = this.gl
    for (const s of this.slots.values()) gl.deleteTexture(s.tex)
    for (const s of this.statics.values()) gl.deleteTexture(s.tex)
    for (const f of this.fbos) { gl.deleteFramebuffer(f.fb); gl.deleteTexture(f.tex) }
    this.slots.clear()
    this.statics.clear()
    this.fbos = []
    this.staticBytes = 0
  }
}

function program(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const s = gl.createShader(type)!
    gl.shaderSource(s, src)
    gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new GLUnavailableError('A WebGL2 shader did not compile (' + gl.getShaderInfoLog(s) + ')')
    gl.attachShader(p, s)
  }
  gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new GLUnavailableError('A WebGL2 program did not link (' + gl.getProgramInfoLog(p) + ')')
  return p
}
