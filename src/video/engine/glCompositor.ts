// WebGL2 compositor: every layer is a textured quad drawn in order over black, premultiplied alpha. The monitor and
// the export each own one (one per canvas); the drawing itself (render.ts) is shared, so a preview frame and an export
// frame are made the same way.
//
//   layer pass   one texture, a quad (transform: position, scale, rotation around an anchor), a crop (UV), opacity
//   mix pass     two inputs: the outgoing and incoming footage are each drawn into their own framebuffer, then mixed
//                by the crossfade's progress in one shader and laid over what is below
//   fx pass      (Phase 2) one "uber" shader per layer, switched by flags: sharpen (one output pixel), chroma key
//                (BT.709 chroma distance + spill suppression), colour (exposure, shadows/highlights, contrast,
//                temperature/tint, saturation, vibrance), a .cube LUT (3D texture, hardware trilinear, intensity),
//                vignette, up to four masks (rectangle/ellipse in the layer's own frame, feather, invert), opacity and
//                the blend mode (normal by hardware blending; the others read the frame below from a copy of it)
//   blur         a layer with blur is first drawn at its drawn size into a framebuffer (key/colour/LUT applied), blurred
//                there in two separable Gaussian passes (radius in output pixels, so preview == export), then laid
//                into the frame by the fx pass (sharpen, vignette, masks, opacity, blend)
//   adjustment   an adjustment layer copies the frame drawn so far and draws it back through its own effects, mixed
//                by its opacity × masks
// No allocations per frame on these paths: uniforms come from the layer's pooled LayerFx, framebuffers are made once
// per frame size, LUTs once per text.
//
// Text and graphics come in as Canvas 2D rasters, uploaded once per change and kept by content key (texture LRU; a
// texture used in the frame being drawn is never evicted by a later upload in the same frame).
// Without WebGL2 the constructor throws GLUnavailableError: the caller shows that, never a wrong frame.
// A lost context (GPU reset, driver update) sets `lost`; when the browser restores it every program, buffer and
// texture is made again and `onRestored` is called (the monitor redraws). An export checks `isLost()` each frame and
// fails with a clear error rather than encode black frames.

import type { Quad, UV } from './layerMath'
import { writeVertices } from './layerMath'

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

/** Effect flags (bits of uFlags). */
export const FX_SHARPEN = 1
export const FX_KEY = 2
export const FX_COLOUR = 4
export const FX_LUT = 8
export const FX_VIGNETTE = 16
export const FX_MASK = 32
/** The person matte (Remove background): multiplies the layer's alpha by a segmentation picture of the same frame. */
export const FX_MATTE = 64
/** The flags a blur prepass applies before blurring (the rest are applied when the blurred layer is laid in). */
const FX_PRE = FX_KEY | FX_COLOUR | FX_LUT | FX_MATTE

const FS_FX = `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 vUv;
uniform sampler2D uTex;
uniform float uAlpha;
uniform vec4 uUvRect;
uniform vec2 uLayerPx;
uniform int uFlags;
uniform vec4 uKey;
uniform float uSpill;
uniform vec4 uCol1;
uniform vec4 uCol2;
uniform sampler3D uLut;
uniform float uLutSize;
uniform float uLutMix;
uniform vec3 uLutMin;
uniform vec3 uLutScale;
uniform vec3 uVig;
uniform float uSharpen;
uniform int uMasks;
uniform vec4 uMaskA[4];
uniform vec4 uMaskB[4];
uniform int uBlend;
uniform sampler2D uBack;
uniform sampler2D uMatte;
uniform float uMatteEdge;
uniform float uMatteInv;
uniform vec2 uRes;
out vec4 o;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

vec3 blendOf(vec3 b, vec3 s) {
  if (uBlend == 1) return b * s;
  if (uBlend == 2) return b + s - b * s;
  if (uBlend == 3) return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(0.5, b));
  if (uBlend == 4) return min(b + s, vec3(1.0));
  if (uBlend == 5) return min(b, s);
  if (uBlend == 6) return max(b, s);
  if (uBlend == 7) {
    vec3 d = mix(((16.0 * b - 12.0) * b + 4.0) * b, sqrt(b), step(0.25, b));
    return mix(b - (1.0 - 2.0 * s) * b * (1.0 - b), b + (2.0 * s - 1.0) * (d - b), step(0.5, s));
  }
  return s;
}

void main() {
  vec4 c = texture(uTex, vUv);
  if ((uFlags & ${FX_SHARPEN}) != 0) {
    vec2 d = (uUvRect.zw - uUvRect.xy) / uLayerPx;
    vec4 nb = texture(uTex, vUv + vec2(d.x, 0.0)) + texture(uTex, vUv - vec2(d.x, 0.0)) + texture(uTex, vUv + vec2(0.0, d.y)) + texture(uTex, vUv - vec2(0.0, d.y));
    c = clamp(c + uSharpen * (4.0 * c - nb), 0.0, 1.0);
    c.rgb = min(c.rgb, vec3(c.a));
  }
  float a = c.a;
  vec3 rgb = a > 0.0 ? c.rgb / a : vec3(0.0);
  if ((uFlags & ${FX_KEY}) != 0) {
    float y = dot(rgb, LUMA);
    vec2 cc = vec2((rgb.b - y) / 1.8556, (rgb.r - y) / 1.5748);
    float k = smoothstep(uKey.z, uKey.w, distance(cc, uKey.xy));
    a *= k;
    float kl = length(uKey.xy);
    if (kl > 1e-4) {
      vec2 kd = uKey.xy / kl;
      float p = dot(cc, kd);
      if (p > 0.0) cc -= kd * p * uSpill;
      rgb.r = y + 1.5748 * cc.y;
      rgb.b = y + 1.8556 * cc.x;
      rgb.g = (y - 0.2126 * rgb.r - 0.0722 * rgb.b) / 0.7152;
      rgb = clamp(rgb, 0.0, 1.0);
    }
  }
  if ((uFlags & ${FX_MATTE}) != 0) {
    float m = texture(uMatte, vUv).r;
    float e = 0.5 * uMatteEdge + 0.004;
    m = smoothstep(0.5 - e, 0.5 + e, m);
    a *= mix(m, 1.0 - m, uMatteInv);
  }
  if ((uFlags & ${FX_COLOUR}) != 0) {
    rgb *= exp2(uCol1.x);
    float l = dot(rgb, LUMA);
    rgb += uCol2.w * 0.25 * (1.0 - smoothstep(0.0, 0.5, l));
    rgb += uCol2.z * 0.25 * smoothstep(0.5, 1.0, l);
    rgb = (rgb - 0.5) * (1.0 + uCol1.y) + 0.5;
    rgb *= vec3(1.0 + 0.2 * uCol2.x, 1.0 - 0.2 * uCol2.y, 1.0 - 0.2 * uCol2.x);
    rgb = clamp(rgb, 0.0, 1.0);
    l = dot(rgb, LUMA);
    rgb = mix(vec3(l), rgb, 1.0 + uCol1.z);
    float sat = max(rgb.r, max(rgb.g, rgb.b)) - min(rgb.r, min(rgb.g, rgb.b));
    rgb = mix(vec3(l), rgb, 1.0 + uCol1.w * (1.0 - clamp(sat, 0.0, 1.0)));
    rgb = clamp(rgb, 0.0, 1.0);
  }
  if ((uFlags & ${FX_LUT}) != 0) {
    vec3 q = clamp((rgb - uLutMin) * uLutScale, 0.0, 1.0);
    vec3 w = q * ((uLutSize - 1.0) / uLutSize) + 0.5 / uLutSize;
    rgb = mix(rgb, texture(uLut, w).rgb, uLutMix);
  }
  vec2 local = (vUv - uUvRect.xy) / (uUvRect.zw - uUvRect.xy);
  if ((uFlags & ${FX_VIGNETTE}) != 0) {
    float v = length(local - 0.5) * 1.41421356;
    rgb *= 1.0 - uVig.x * smoothstep(uVig.y, uVig.y + uVig.z, v);
  }
  if ((uFlags & ${FX_MASK}) != 0) {
    vec2 p = local * uLayerPx;
    float shortSide = min(uLayerPx.x, uLayerPx.y);
    for (int i = 0; i < 4; i++) {
      if (i >= uMasks) break;
      vec2 cpx = uMaskA[i].xy * uLayerPx;
      vec2 hpx = max(uMaskA[i].zw * uLayerPx, vec2(0.5));
      float d;
      if (uMaskB[i].x > 0.5) {
        float r = length((p - cpx) / hpx);
        d = (r - 1.0) * min(hpx.x, hpx.y);
      } else {
        vec2 q = abs(p - cpx) - hpx;
        d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
      }
      float f = uMaskB[i].y * shortSide;
      float m = f > 0.5 ? 1.0 - smoothstep(-0.5 * f, 0.5 * f, d) : clamp(0.5 - d, 0.0, 1.0);
      if (uMaskB[i].z > 0.5) m = 1.0 - m;
      a *= m;
    }
  }
  a *= uAlpha;
  if (uBlend == 0) { o = vec4(rgb * a, a); return; }
  vec3 b = texture(uBack, gl_FragCoord.xy / uRes).rgb;
  o = vec4(mix(b, blendOf(b, rgb), a), 1.0);
}`

const VS_PASS = `#version 300 es
in vec2 aPos;
uniform vec2 uMax;
out vec2 vUv;
void main() { vUv = (aPos * 0.5 + 0.5) * uMax; gl_Position = vec4(aPos, 0.0, 1.0); }`

const FS_BLUR = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uMax;
uniform vec2 uTexel;
uniform vec2 uDir;
uniform float uSigma;
out vec4 o;
void main() {
  vec2 lo = 0.5 * uTexel;
  vec2 hi = uMax - 0.5 * uTexel;
  float st = max(1.0, uSigma * 3.0 / 32.0);
  int n = int(ceil(uSigma * 3.0 / st));
  vec4 s = texture(uTex, clamp(vUv, lo, hi));
  float ws = 1.0;
  for (int i = 1; i <= 40; i++) {
    if (i > n) break;
    float x = float(i) * st;
    float w = exp(-0.5 * x * x / (uSigma * uSigma));
    vec2 off = uDir * uTexel * x;
    s += w * (texture(uTex, clamp(vUv + off, lo, hi)) + texture(uTex, clamp(vUv - off, lo, hi)));
    ws += 2.0 * w;
  }
  o = s / ws;
}`

/** One layer's effects for this frame, resolved by render.ts into a pooled object (no allocation per frame). */
export interface LayerFx {
  flags: number
  /** Chroma key: key Cb, Cr, inner and outer distance. */
  key: Float32Array
  spill: number
  /** exposure, contrast, saturation, vibrance */
  col1: Float32Array
  /** temperature, tint, highlights, shadows */
  col2: Float32Array
  /** The .cube text (also the texture's cache key). */
  lut: string | null
  lutMix: number
  /** Gaussian sigma in output pixels (0 = none). */
  blur: number
  sharpen: number
  /** amount, size, softness */
  vig: Float32Array
  masks: number
  /** per mask: centre x, y and half width, height, in the layer's frame (0..1) */
  maskA: Float32Array
  /** per mask: shape (0 rect, 1 ellipse), feather (share of the shorter side), invert (0/1), 0 */
  maskB: Float32Array
  /** 0 normal … 7 soft light (effects.ts BLEND_MODES order) */
  blend: number
  /** Remove background: the effect is on (render.ts then supplies `matte` for the frame, or draws without it while the model loads). */
  wantMatte: boolean
  matteEdge: number
  /** 0 keep the person, 1 keep the background */
  matteInvert: number
  matte: { w: number; h: number; data: Uint8Array; rev: number } | null
  matteSlot: string
}

export function newLayerFx(): LayerFx {
  return { flags: 0, key: new Float32Array(4), spill: 0, col1: new Float32Array(4), col2: new Float32Array(4), lut: null, lutMix: 1, blur: 0, sharpen: 0, vig: new Float32Array(3), masks: 0, maskA: new Float32Array(16), maskB: new Float32Array(16), blend: 0, wantMatte: false, matteEdge: 0, matteInvert: 0, matte: null, matteSlot: '' }
}

export function resetLayerFx(fx: LayerFx) {
  fx.flags = 0; fx.lut = null; fx.blur = 0; fx.blend = 0; fx.masks = 0; fx.sharpen = 0; fx.spill = 0; fx.lutMix = 1
  fx.wantMatte = false; fx.matteEdge = 0; fx.matteInvert = 0; fx.matte = null; fx.matteSlot = ''
}

/** Does this layer need the fx path at all? */
export const fxActive = (fx: LayerFx | null | undefined): fx is LayerFx => !!fx && (fx.flags !== 0 || fx.blur > 0.25 || fx.blend !== 0)

/** Parsed LUT data the compositor uploads (effects.ts CubeLut). */
export interface LutData { size: number; data: Float32Array; domainMin: [number, number, number]; domainMax: [number, number, number] }

export interface TexHandle { tex: WebGLTexture; width: number; height: number }
interface CachedTex extends TexHandle { key: string; bytes: number; frame: number }

/** What a layer draw needs: its texture and where it lands (and, Phase 2, its effects). */
export interface LayerDraw { tex: TexHandle; quad: Quad; uv: UV; alpha: number; fx?: LayerFx | null }

type FxUniforms = Record<'tex' | 'alpha' | 'uvRect' | 'layerPx' | 'flags' | 'key' | 'spill' | 'col1' | 'col2' | 'lut' | 'lutSize' | 'lutMix' | 'lutMin' | 'lutScale' | 'vig' | 'sharpen' | 'masks' | 'maskA' | 'maskB' | 'blend' | 'back' | 'res' | 'matte' | 'matteEdge' | 'matteInv', WebGLUniformLocation | null>
type Fbo = { fb: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number }

export class GLCompositor {
  readonly gl: WebGL2RenderingContext
  width = 0
  height = 0
  lost = false
  /** The context was restored after a loss (resources are new; draw again). */
  onRestored: () => void = () => {}
  /** The context was lost. */
  onLost: () => void = () => {}
  private layerProg!: WebGLProgram
  private mixProg!: WebGLProgram
  private vao!: WebGLVertexArrayObject
  private vbo!: WebGLBuffer
  private fullVao!: WebGLVertexArrayObject
  private uLayer!: { res: WebGLUniformLocation | null; tex: WebGLUniformLocation | null; alpha: WebGLUniformLocation | null }
  private uMix!: { a: WebGLUniformLocation | null; b: WebGLUniformLocation | null; p: WebGLUniformLocation | null }
  /** Frames begun (a static texture used in the current one is pinned). */
  private frame = 0
  private fbos: Fbo[] = []
  private fxProg!: WebGLProgram
  private blurProg!: WebGLProgram
  private uFx!: FxUniforms
  private uBlur!: Record<'tex' | 'max' | 'texel' | 'dir' | 'sigma', WebGLUniformLocation | null>
  /** Framebuffers of the fx paths at frame size: the backdrop copy and two for a blur prepass. */
  private back: Fbo | null = null
  private fxFbos: (Fbo | null)[] = [null, null]
  /** Where draws go now: the canvas (null) or a crossfade input. */
  private target: WebGLFramebuffer | null = null
  /** Inside a crossfade input: blend modes are not applied (there is no frame below to blend with). */
  private inMix = false
  /** LUT 3D textures by .cube text, LRU. */
  /** Person mattes, one texture per layer slot, re-uploaded only when the picture's rev changes. */
  private mattes = new Map<string, { tex: WebGLTexture; rev: number; w: number; h: number }>()
  private luts = new Map<string, { tex: WebGLTexture; size: number; min: Float32Array; scale: Float32Array }>()
  private quadScratch = new Float32Array(8) as unknown as Quad
  private uvScratch: UV = [0, 0, 1, 1]
  /** fx passes drawn (tests and the perf notes). */
  fxDraws = 0
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
      canvas.addEventListener('webglcontextlost', ((e: Event) => { e.preventDefault(); this.lost = true; this.onLost() }) as EventListener)
      canvas.addEventListener('webglcontextrestored', (() => {
        // every old handle is dead: forget them and make the resources again
        this.slots.clear()
        this.statics.clear()
        this.staticBytes = 0
        this.fbos = []
        this.back = null
        this.fxFbos = [null, null]
        this.luts.clear()
        try { this.init(); this.lost = false; this.onRestored() } catch { this.lost = true }
      }) as EventListener)
    }
    this.init()
  }

  /** The context is lost now (an event may not have arrived yet). */
  isLost(): boolean { return this.lost || this.gl.isContextLost() }

  private init() {
    const gl = this.gl
    this.layerProg = program(gl, VS, FS_LAYER)
    this.mixProg = program(gl, VS_FULL, FS_MIX)
    this.uLayer = { res: gl.getUniformLocation(this.layerProg, 'uRes'), tex: gl.getUniformLocation(this.layerProg, 'uTex'), alpha: gl.getUniformLocation(this.layerProg, 'uAlpha') }
    this.uMix = { a: gl.getUniformLocation(this.mixProg, 'uA'), b: gl.getUniformLocation(this.mixProg, 'uB'), p: gl.getUniformLocation(this.mixProg, 'uP') }
    this.fxProg = program(gl, VS, FS_FX)
    this.blurProg = program(gl, VS_PASS, FS_BLUR)
    const fu = (n: string) => gl.getUniformLocation(this.fxProg, n)
    this.uFx = {
      tex: fu('uTex'), alpha: fu('uAlpha'), uvRect: fu('uUvRect'), layerPx: fu('uLayerPx'), flags: fu('uFlags'), key: fu('uKey'), spill: fu('uSpill'),
      col1: fu('uCol1'), col2: fu('uCol2'), lut: fu('uLut'), lutSize: fu('uLutSize'), lutMix: fu('uLutMix'), lutMin: fu('uLutMin'), lutScale: fu('uLutScale'),
      vig: fu('uVig'), sharpen: fu('uSharpen'), masks: fu('uMasks'), maskA: fu('uMaskA'), maskB: fu('uMaskB'), blend: fu('uBlend'), back: fu('uBack'), res: fu('uRes'),
      matte: fu('uMatte'), matteEdge: fu('uMatteEdge'), matteInv: fu('uMatteInv'),
    }
    // every sampler on its own unit, for good: a sampler3D left on unit 0 beside uTex makes every draw invalid
    gl.useProgram(this.fxProg)
    gl.uniform1i(this.uFx.tex, 0)
    gl.uniform1i(this.uFx.back, 1)
    gl.uniform1i(this.uFx.lut, 2)
    gl.uniform1i(this.uFx.matte, 3)
    const bu = (n: string) => gl.getUniformLocation(this.blurProg, n)
    this.uBlur = { tex: bu('uTex'), max: bu('uMax'), texel: bu('uTexel'), dir: bu('uDir'), sigma: bu('uSigma') }

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
    this.frame++
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h }
    this.width = w
    this.height = h
    this.target = null
    this.inMix = false
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

  /** The texture of a person matte (R8, linear). Null if the picture is not usable. */
  matteTexture(slot: string, m: { w: number; h: number; data: Uint8Array; rev: number }): WebGLTexture | null {
    const gl = this.gl
    if (m.w < 1 || m.h < 1 || m.data.length < m.w * m.h) return null
    let e = this.mattes.get(slot)
    if (!e) {
      const tex = gl.createTexture()
      if (!tex) return null
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      e = { tex, rev: -1, w: 0, h: 0 }
      this.mattes.set(slot, e)
    }
    if (e.rev !== m.rev || e.w !== m.w || e.h !== m.h) {
      gl.bindTexture(gl.TEXTURE_2D, e.tex)
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, m.w, m.h, 0, gl.RED, gl.UNSIGNED_BYTE, m.data)
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
      e.rev = m.rev; e.w = m.w; e.h = m.h
    }
    return e.tex
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

  /** A slot texture exists (it was drawn and not pruned since). */
  hasSlot(slot: string) { return this.slots.has(slot) }

  /** Drop slot textures not in `keep` (clips that left the screen). */
  pruneSlots(keep: Set<string>) {
    for (const [k, s] of this.slots) if (!keep.has(k)) { this.gl.deleteTexture(s.tex); this.slots.delete(k) }
  }

  /** A static texture by content key, made (rasterised and uploaded) only when it is not cached. */
  staticTexture(key: string, make: () => { src: TexImageSource; width: number; height: number } | null): TexHandle | null {
    const hit = this.statics.get(key)
    if (hit) { this.statics.delete(key); this.statics.set(key, hit); hit.frame = this.frame; return hit }
    const m = make()
    if (!m) return null
    const tex = this.newTexture()
    this.upload(tex, m.src)
    const e: CachedTex = { key, tex, width: m.width, height: m.height, bytes: m.width * m.height * 4, frame: this.frame }
    this.statics.set(key, e)
    this.staticBytes += e.bytes
    for (const [k, v] of this.statics) {
      if (this.staticBytes <= this.staticBudget) break
      // the textures of the frame being drawn stay (it may still draw them), even over budget for this frame
      if (k === key || v.frame === this.frame) continue
      this.gl.deleteTexture(v.tex)
      this.statics.delete(k)
      this.staticBytes -= v.bytes
    }
    return e
  }

  /** Free the static textures whose key matches (stale rasters: fonts arrived since they were made). */
  evictStatics(match: (key: string) => boolean) {
    for (const [k, v] of this.statics) {
      if (!match(k)) continue
      this.gl.deleteTexture(v.tex)
      this.statics.delete(k)
      this.staticBytes -= v.bytes
    }
  }

  get staticCount() { return this.statics.size }

  /** One layer over what is drawn. */
  draw(d: LayerDraw) {
    if (d.alpha <= 0) return
    if (fxActive(d.fx)) { this.drawFx(d, d.fx); return }
    const gl = this.gl
    gl.useProgram(this.layerProg)
    gl.uniform2f(this.uLayer.res, this.width, this.height)
    gl.uniform1f(this.uLayer.alpha, Math.min(1, d.alpha))
    gl.uniform1i(this.uLayer.tex, 0)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, d.tex.tex)
    this.quad(d.quad, d.uv)
  }

  /** Upload a quad's vertices into the shared buffer and draw it (no allocation). */
  private quad(q: Quad, uv: UV) {
    const gl = this.gl
    gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, writeVertices(this.vertScratch, q, uv))
    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4)
  }
  private vertScratch = new Float32Array(16)

  private makeFbo(w: number, h: number, old: Fbo | null | undefined): Fbo {
    const gl = this.gl
    if (old && old.w === w && old.h === h) return old
    if (old) { gl.deleteFramebuffer(old.fb); gl.deleteTexture(old.tex) }
    const tex = this.newTexture()
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    const fb = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.target)
    return { fb, tex, w, h }
  }

  private fbo(i: number) {
    const f = this.makeFbo(this.width, this.height, this.fbos[i])
    this.fbos[i] = f
    return f
  }

  private fxFbo(i: number) {
    const f = this.makeFbo(this.width, this.height, this.fxFbos[i])
    this.fxFbos[i] = f
    return f
  }

  /** Copy what is drawn in the current target into the backdrop texture (blend modes and adjustment layers read it). */
  private copyBackdrop(): Fbo {
    const gl = this.gl
    this.back = this.makeFbo(this.width, this.height, this.back)
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.target)
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.back.fb)
    gl.blitFramebuffer(0, 0, this.width, this.height, 0, 0, this.width, this.height, gl.COLOR_BUFFER_BIT, gl.NEAREST)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.target)
    return this.back
  }

  /** Make sure the 3D texture of a LUT exists (made once per .cube text; at most four kept). False: no LUT. */
  lutTexture(key: string, make: () => LutData | null): boolean {
    const hit = this.luts.get(key)
    if (hit) { this.luts.delete(key); this.luts.set(key, hit); return true }
    const lut = make()
    if (!lut) return false
    const gl = this.gl
    const tex = gl.createTexture()!
    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_3D, tex)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE)
    // WebGL refuses a 3D upload from an array while the premultiply flag is on
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB16F, lut.size, lut.size, lut.size, 0, gl.RGB, gl.FLOAT, lut.data)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
    gl.activeTexture(gl.TEXTURE0)
    const min = new Float32Array(lut.domainMin)
    const scale = new Float32Array(3)
    for (let j = 0; j < 3; j++) scale[j] = 1 / (lut.domainMax[j] - lut.domainMin[j])
    this.luts.set(key, { tex, size: lut.size, min, scale })
    this.uploads++
    while (this.luts.size > 4) {
      const [k, v] = this.luts.entries().next().value!
      gl.deleteTexture(v.tex)
      this.luts.delete(k)
    }
    return true
  }

  get lutCount() { return this.luts.size }

  /** Set every fx uniform for one pass and draw `q` (uv) from `tex`. */
  private fxPass(tex: WebGLTexture, q: Quad, uv: UV, resW: number, resH: number, layerW: number, layerH: number, flags: number, alpha: number, blend: number, fx: LayerFx) {
    const gl = this.gl
    const u = this.uFx
    gl.useProgram(this.fxProg)
    gl.uniform2f(u.res, resW, resH)
    gl.uniform1i(u.tex, 0)
    gl.uniform1f(u.alpha, Math.min(1, alpha))
    gl.uniform4f(u.uvRect, uv[0], uv[1], uv[2], uv[3])
    gl.uniform2f(u.layerPx, Math.max(1, layerW), Math.max(1, layerH))
    let f = flags
    if (f & FX_LUT) {
      const l = fx.lut ? this.luts.get(fx.lut) : undefined
      if (!l) f &= ~FX_LUT
      else {
        gl.activeTexture(gl.TEXTURE2)
        gl.bindTexture(gl.TEXTURE_3D, l.tex)
        gl.uniform1i(u.lut, 2)
        gl.uniform1f(u.lutSize, l.size)
        gl.uniform1f(u.lutMix, fx.lutMix)
        gl.uniform3fv(u.lutMin, l.min)
        gl.uniform3fv(u.lutScale, l.scale)
      }
    }
    if (f & FX_MATTE) {
      const mt = fx.matte ? this.matteTexture(fx.matteSlot, fx.matte) : null
      if (!mt) f &= ~FX_MATTE
      else {
        gl.activeTexture(gl.TEXTURE3)
        gl.bindTexture(gl.TEXTURE_2D, mt)
        gl.uniform1f(u.matteEdge, fx.matteEdge)
        gl.uniform1f(u.matteInv, fx.matteInvert)
      }
    }
    gl.uniform1i(u.flags, f)
    if (f & FX_KEY) { gl.uniform4fv(u.key, fx.key); gl.uniform1f(u.spill, fx.spill) }
    if (f & FX_COLOUR) { gl.uniform4fv(u.col1, fx.col1); gl.uniform4fv(u.col2, fx.col2) }
    if (f & FX_VIGNETTE) gl.uniform3fv(u.vig, fx.vig)
    if (f & FX_SHARPEN) gl.uniform1f(u.sharpen, fx.sharpen)
    if (f & FX_MASK) { gl.uniform1i(u.masks, fx.masks); gl.uniform4fv(u.maskA, fx.maskA); gl.uniform4fv(u.maskB, fx.maskB) }
    gl.uniform1i(u.blend, blend)
    if (blend && this.back) {
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, this.back.tex)
      gl.uniform1i(u.back, 1)
    }
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    this.quad(q, uv)
    this.fxDraws++
  }

  /** Blur `src` (its first w×h texels) into fx framebuffer `into`, along `dir`. */
  private blurPass(src: WebGLTexture, into: Fbo, w: number, h: number, dirX: number, dirY: number, sigma: number) {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, into.fb)
    gl.viewport(0, 0, w, h)
    gl.useProgram(this.blurProg)
    gl.uniform1i(this.uBlur.tex, 0)
    gl.uniform2f(this.uBlur.max, w / into.w, h / into.h)
    gl.uniform2f(this.uBlur.texel, 1 / into.w, 1 / into.h)
    gl.uniform2f(this.uBlur.dir, dirX, dirY)
    gl.uniform1f(this.uBlur.sigma, sigma)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, src)
    gl.bindVertexArray(this.fullVao)
    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4)
  }

  /** Draw `tex` (uv) at w×h into fx framebuffer 0 with the pre-blur effects, blur it there; returns its uv. */
  private blurred(tex: WebGLTexture, uv: UV, w: number, h: number, fx: LayerFx, sigma: number): UV {
    const gl = this.gl
    const f0 = this.fxFbo(0)
    const f1 = this.fxFbo(1)
    gl.disable(gl.BLEND)
    gl.bindFramebuffer(gl.FRAMEBUFFER, f0.fb)
    gl.viewport(0, 0, w, h)
    const q = this.quadScratch
    q[0] = 0; q[1] = 0; q[2] = w; q[3] = 0; q[4] = w; q[5] = h; q[6] = 0; q[7] = h
    this.fxPass(tex, q, uv, w, h, w, h, fx.flags & FX_PRE, 1, 0, fx)
    this.blurPass(f0.tex, f1, w, h, 1, 0, sigma)
    this.blurPass(f1.tex, f0, w, h, 0, 1, sigma)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.target)
    gl.viewport(0, 0, this.width, this.height)
    gl.enable(gl.BLEND)
    const out = this.uvScratch
    out[0] = 0; out[1] = h / f0.h; out[2] = w / f0.w; out[3] = 0
    return out
  }

  /** A layer through its effects (blur prepass when it has one), then laid in with its blend mode. */
  private drawFx(d: LayerDraw, fx: LayerFx) {
    const gl = this.gl
    const q = d.quad
    const lw = Math.hypot(q[2] - q[0], q[3] - q[1])
    const lh = Math.hypot(q[6] - q[0], q[7] - q[1])
    let tex = d.tex.tex
    let uv = d.uv
    let flags = fx.flags
    if (fx.blur > 0.25) {
      // the prepass is at the layer's drawn size, capped by the frame (the blur radius follows that scale)
      const s = Math.min(1, this.width / Math.max(1, lw), this.height / Math.max(1, lh))
      const w = Math.max(1, Math.round(lw * s))
      const h = Math.max(1, Math.round(lh * s))
      uv = this.blurred(tex, uv, w, h, fx, fx.blur * s)
      tex = this.fxFbos[0]!.tex
      flags &= ~FX_PRE
    }
    const blend = this.inMix ? 0 : fx.blend
    if (blend) { this.copyBackdrop(); gl.disable(gl.BLEND) }
    this.fxPass(tex, q, uv, this.width, this.height, lw, lh, flags, d.alpha, blend, fx)
    if (blend) gl.enable(gl.BLEND)
  }

  /** An adjustment layer: the frame drawn so far, through `fx`, mixed back by `alpha` × its masks. */
  adjust(fx: LayerFx, alpha: number) {
    if (alpha <= 0 || this.inMix) return
    const flags = fx.flags & ~FX_KEY
    if (!(flags & ~FX_MASK) && fx.blur <= 0.25) return
    const back = this.copyBackdrop()
    const W = this.width
    const H = this.height
    let tex = back.tex
    let uv: UV = this.uvScratch
    uv[0] = 0; uv[1] = 1; uv[2] = 1; uv[3] = 0
    let f = flags
    if (fx.blur > 0.25) { uv = this.blurred(tex, uv, W, H, fx, fx.blur); tex = this.fxFbos[0]!.tex; f &= ~FX_PRE }
    const q = this.quadScratch
    q[0] = 0; q[1] = 0; q[2] = W; q[3] = 0; q[4] = W; q[5] = H; q[6] = 0; q[7] = H
    this.fxPass(tex, q, uv, W, H, W, H, f, alpha, 0, fx)
  }

  /** A two-input crossfade: `a` and `b` each drawn alone into a framebuffer, then mixed by `progress` over what is
   * drawn (premultiplied, so a part of `b` with no picture — fit bars — shows `a` fading out over the layers below). */
  mix(a: LayerDraw | null, b: LayerDraw, progress: number) {
    const gl = this.gl
    const fa = this.fbo(0)
    const fb = this.fbo(1)
    const outer = this.target
    this.inMix = true
    for (let i = 0; i < 2; i++) {
      const f = i === 0 ? fa : fb
      const d = i === 0 ? a : b
      this.target = f.fb
      gl.bindFramebuffer(gl.FRAMEBUFFER, f.fb)
      gl.viewport(0, 0, this.width, this.height)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      if (d) this.draw(d)
    }
    this.inMix = false
    this.target = outer
    gl.bindFramebuffer(gl.FRAMEBUFFER, outer)
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
    for (const f of [...this.fbos, ...this.fxFbos, this.back]) if (f) { gl.deleteFramebuffer(f.fb); gl.deleteTexture(f.tex) }
    for (const l of this.luts.values()) gl.deleteTexture(l.tex)
    this.luts.clear()
    this.fxFbos = [null, null]
    this.back = null
    this.slots.clear()
    this.statics.clear()
    this.fbos = []
    this.staticBytes = 0
  }
}

function program(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!
  // every program reads its vertices from the same two VAOs: pin the attribute slots
  gl.bindAttribLocation(p, 0, 'aPos')
  gl.bindAttribLocation(p, 1, 'aUv')
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
