import { TRANSITIONS } from '@core/index'
import type { CaptionClip, Id, Layer, Scene, SceneNode } from '@core/index'
import { compileProgram, createTexture } from './gl'
import { rasterizeShape, rasterizeText, type Raster } from './raster'
import {
  BLEND_MODES,
  COMPOSITE_FRAGMENT,
  COPY_FRAGMENT,
  EFFECT_FRAGMENTS,
  FULLSCREEN_VERTEX,
  LAYER_FRAGMENT,
  LAYER_VERTEX,
  TRANSITION_FRAGMENT
} from './shaders'

/** Supplies pixels for media-backed layers. Returning null draws nothing for that layer this frame. */
export interface FrameSource {
  videoFrame(layer: Layer): VideoFrame | null
  image(mediaId: Id): ImageBitmap | null
}

interface Target {
  framebuffer: WebGLFramebuffer
  texture: WebGLTexture
}

interface Program {
  program: WebGLProgram
  uniforms: Map<string, WebGLUniformLocation | null>
}

interface CachedTexture {
  texture: WebGLTexture
  width: number
  height: number
  lastUsed: number
  /** Identifies the uploaded content, to skip redundant uploads. */
  stamp: unknown
}

const MAX_RASTERS = 64

function parseColor(color: string): [number, number, number] {
  const hex = color.replace('#', '')
  const n = parseInt(hex.length === 3 ? hex.replace(/./g, '$&$&') : hex.slice(0, 6), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

/**
 * Renders a Scene with WebGL2. The preview and the exporter use this same class, which is what
 * guarantees that an export looks exactly like the preview.
 */
export class Compositor {
  readonly gl: WebGL2RenderingContext
  private width = 0
  private height = 0
  /** Render pixels per project pixel (< 1 for a lighter preview). */
  private scale = 1
  private tick = 0

  private readonly programs = new Map<string, Program>()
  private targets: Target[] = []
  private readonly layerTextures = new Map<Id, CachedTexture>()
  private readonly imageTextures = new Map<Id, CachedTexture>()
  private readonly rasterTextures = new Map<string, CachedTexture>()

  constructor(
    readonly canvas: HTMLCanvasElement | OffscreenCanvas,
    private readonly flipOutput = false
  ) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: flipOutput,
      powerPreference: 'high-performance'
    }) as WebGL2RenderingContext | null
    if (!gl) throw new Error('WebGL2 is not available')
    this.gl = gl

    const vao = gl.createVertexArray()
    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
    gl.disable(gl.DEPTH_TEST)
  }

  /** Output size in render pixels for a project of `width`×`height` at `scale`. */
  setSize(width: number, height: number, scale = 1): void {
    const w = Math.max(2, Math.round(width * scale))
    const h = Math.max(2, Math.round(height * scale))
    if (w === this.width && h === this.height && scale === this.scale) return
    this.width = w
    this.height = h
    this.scale = scale
    this.canvas.width = w
    this.canvas.height = h
    const { gl } = this
    for (const t of this.targets) {
      gl.deleteFramebuffer(t.framebuffer)
      gl.deleteTexture(t.texture)
    }
    this.targets = Array.from({ length: 6 }, () => this.createTarget())
  }

  render(scene: Scene, source: FrameSource): void {
    const { gl } = this
    this.tick++
    if (this.width === 0) this.setSize(scene.width, scene.height)
    let [accRead, accWrite, layerA, layerB, fromTarget, toTarget] = this.targets as [
      Target,
      Target,
      Target,
      Target,
      Target,
      Target
    ]

    this.bind(accRead)
    const [r, g, b] = parseColor(scene.background)
    gl.clearColor(r, g, b, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)

    const composite = (node: SceneNode): void => {
      let result: Target | null
      let blendMode: string
      if (node.kind === 'layer') {
        result = this.renderLayer(node, source, layerA, layerB)
        blendMode = node.blendMode
      } else {
        const from = this.renderLayer(node.from, source, fromTarget, layerB) ?? this.cleared(fromTarget)
        // renderLayer may hand back its scratch target; keep the two results apart.
        const scratch = from === layerB ? fromTarget : layerB
        const to = this.renderLayer(node.to, source, toTarget, scratch) ?? this.cleared(toTarget)
        // layerA is never handed to renderLayer above, so it is free to receive the mix.
        const out = layerA
        this.bind(out)
        const p = this.use('transition', FULLSCREEN_VERTEX, TRANSITION_FRAGMENT)
        this.texture(p, 'u_from', 0, from.texture)
        this.texture(p, 'u_to', 1, to.texture)
        gl.uniform1f(p.uniforms.get('u_progress')!, node.progress)
        gl.uniform1i(
          p.uniforms.get('u_type')!,
          Math.max(
            0,
            TRANSITIONS.findIndex((t) => t.type === node.type)
          )
        )
        gl.uniform1f(p.uniforms.get('u_aspect')!, this.width / this.height)
        this.drawFullscreen(p)
        result = out
        blendMode = 'normal'
      }
      if (!result) return
      this.bind(accWrite)
      const p = this.use('composite', FULLSCREEN_VERTEX, COMPOSITE_FRAGMENT)
      this.texture(p, 'u_backdrop', 0, accRead.texture)
      this.texture(p, 'u_layer', 1, result.texture)
      gl.uniform1i(
        p.uniforms.get('u_mode')!,
        Math.max(0, BLEND_MODES.indexOf(blendMode as (typeof BLEND_MODES)[number]))
      )
      this.drawFullscreen(p)
      ;[accRead, accWrite] = [accWrite, accRead]
    }

    for (const node of scene.nodes) composite(node)
    for (const caption of scene.captions) {
      composite(this.captionLayer(scene, caption))
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, this.width, this.height)
    const copy = this.use('copy', FULLSCREEN_VERTEX, COPY_FRAGMENT)
    this.texture(copy, 'u_tex', 0, accRead.texture)
    this.drawFullscreen(copy, this.flipOutput ? -1 : 1)
    this.evictRasters()
  }

  /** Reads the last rendered frame as top-down RGBA rows (requires `flipOutput`). */
  readPixels(target: Uint8Array): void {
    this.gl.readPixels(0, 0, this.width, this.height, this.gl.RGBA, this.gl.UNSIGNED_BYTE, target)
  }

  /** Size in project pixels of what a layer draws before its transform; used by the viewer's gizmo too. */
  layerSize(
    layer: Layer,
    scene: Pick<Scene, 'width' | 'height'>,
    source: FrameSource
  ): [number, number] | null {
    const { clip } = layer
    const fit = (w: number, h: number): [number, number] => {
      const s = Math.min(scene.width / w, scene.height / h)
      return [w * s, h * s]
    }
    if (clip.type === 'video') {
      const frame = source.videoFrame(layer)
      return frame ? fit(frame.displayWidth, frame.displayHeight) : null
    }
    if (clip.type === 'image') {
      const image = source.image(clip.mediaId)
      return image ? fit(image.width, image.height) : null
    }
    if (clip.type === 'text') {
      const raster = rasterizeText(clip.text, clip.style, clip.boxWidth, 0.05)
      return [raster.width, raster.height]
    }
    return [clip.size[0] + clip.strokeWidth, clip.size[1] + clip.strokeWidth]
  }

  forgetClip(clipId: Id): void {
    const cached = this.layerTextures.get(clipId)
    if (cached) this.gl.deleteTexture(cached.texture)
    this.layerTextures.delete(clipId)
  }

  dispose(): void {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext()
  }

  // ── Layers ──────────────────────────────────────────────────────────────────────────────────────

  /** Draws a layer plus its effects. Returns the target holding the result (`primary` or `scratch`). */
  private renderLayer(layer: Layer, source: FrameSource, primary: Target, scratch: Target): Target | null {
    const content = this.layerContent(layer, source)
    if (!content || layer.transform.opacity <= 0) return null
    const { gl } = this
    this.cleared(primary)

    const p = this.use('layer', LAYER_VERTEX, LAYER_FRAGMENT)
    const { crop, transform } = layer
    const u0 = Math.min(crop.left, 0.999)
    const v0 = Math.min(crop.top, 0.999)
    const u1 = Math.max(1 - crop.right, u0 + 0.001)
    const v1 = Math.max(1 - crop.bottom, v0 + 0.001)
    gl.uniformMatrix3fv(
      p.uniforms.get('u_matrix')!,
      false,
      this.layerMatrix(transform, content.width, content.height)
    )
    gl.uniform4f(p.uniforms.get('u_uvRect')!, u0, v0, u1, v1)
    gl.uniform1f(p.uniforms.get('u_opacity')!, transform.opacity)
    this.texture(p, 'u_tex', 0, content.texture)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

    let read = primary
    let write = scratch
    const pass = (type: string, params: Record<string, number>, setup?: (p: Program) => void): void => {
      const fragment = EFFECT_FRAGMENTS[type]
      if (!fragment) return
      this.bind(write)
      const program = this.use(`effect:${type}`, FULLSCREEN_VERTEX, fragment)
      this.texture(program, 'u_tex', 0, read.texture)
      gl.uniform2f(program.uniforms.get('u_texel')!, 1 / this.width, 1 / this.height)
      for (const [key, value] of Object.entries(params)) {
        const location = program.uniforms.get(key)
        if (location) gl.uniform1f(location, value)
      }
      setup?.(program)
      this.drawFullscreen(program)
      ;[read, write] = [write, read]
    }
    for (const effect of layer.effects) {
      if (effect.type === 'blur') {
        const params = { radius: (effect.params['radius'] ?? 0) * this.scale }
        pass('blur', params, (pr) => gl.uniform2f(pr.uniforms.get('u_direction')!, 1, 0))
        pass('blur', params, (pr) => gl.uniform2f(pr.uniforms.get('u_direction')!, 0, 1))
      } else if (effect.type === 'pixelate') {
        pass('pixelate', { size: (effect.params['size'] ?? 1) * this.scale })
      } else pass(effect.type, effect.params)
    }
    return read
  }

  /** Column-major matrix taking layer UV (0..1, y down) to clip space. */
  private layerMatrix(t: Layer['transform'], w: number, h: number): Float32Array {
    const W = this.width / this.scale
    const H = this.height / this.scale
    const rad = (t.rotation * Math.PI) / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    // pixel = T(centre + position) · R · S · T(-anchor) · S(w, h) · uv
    const ax = w * t.scaleX
    const ay = h * t.scaleY
    const a = cos * ax
    const b = sin * ax
    const c = -sin * ay
    const d = cos * ay
    const ox = -t.anchorX
    const oy = -t.anchorY
    const tx = W / 2 + t.x + a * ox + c * oy
    const ty = H / 2 + t.y + b * ox + d * oy
    // pixels → NDC (y flipped: project y grows downwards)
    const sx = 2 / W
    const sy = -2 / H
    return new Float32Array([a * sx, b * sy, 0, c * sx, d * sy, 0, tx * sx - 1, ty * sy + 1, 1])
  }

  private layerContent(layer: Layer, source: FrameSource): CachedTexture | null {
    const { clip } = layer
    const { gl } = this
    if (clip.type === 'video') {
      const frame = source.videoFrame(layer)
      if (!frame) return null
      const cached = this.layerTextures.get(clip.id) ?? this.newCached(this.layerTextures, clip.id)
      if (cached.stamp !== frame.timestamp || cached.width === 0) {
        gl.bindTexture(gl.TEXTURE_2D, cached.texture)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame)
        cached.stamp = frame.timestamp
      }
      return this.fitted(cached, frame.displayWidth, frame.displayHeight)
    }
    if (clip.type === 'image') {
      const image = source.image(clip.mediaId)
      if (!image) return null
      const cached = this.imageTextures.get(clip.mediaId) ?? this.newCached(this.imageTextures, clip.mediaId)
      if (cached.stamp !== image) {
        gl.bindTexture(gl.TEXTURE_2D, cached.texture)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
        cached.stamp = image
      }
      return this.fitted(cached, image.width, image.height)
    }
    const zoom = Math.max(Math.abs(layer.transform.scaleX), Math.abs(layer.transform.scaleY), 0.05)
    // Quantised so an animated scale re-rasterises a handful of times, not every frame.
    const quality = Math.min(4, Math.max(0.25, Math.ceil(zoom * this.scale * 4) / 4))
    if (clip.type === 'text') {
      const key = `t:${quality}:${clip.boxWidth}:${clip.text}:${JSON.stringify(clip.style)}`
      return this.rasterTexture(key, () => rasterizeText(clip.text, clip.style, clip.boxWidth, quality))
    }
    const key = `s:${quality}:${clip.shape}:${clip.size.join('x')}:${clip.fill}:${clip.strokeColor}:${clip.strokeWidth}:${clip.cornerRadius}`
    return this.rasterTexture(key, () => rasterizeShape(clip, quality))
  }

  private captionLayer(scene: Scene, caption: CaptionClip): Layer {
    const style = scene.captionStyle
    const margin = scene.height * 0.06
    return {
      kind: 'layer',
      // A synthetic text clip: captions share the text rasteriser.
      clip: {
        id: caption.id,
        type: 'text',
        name: '',
        start: caption.start,
        duration: caption.duration,
        text: caption.text,
        style,
        boxWidth: scene.width * 0.8,
        blendMode: 'normal',
        effects: [],
        transform: {
          position: { value: [0, 0] },
          scale: { value: [1, 1] },
          rotation: { value: 0 },
          opacity: { value: 1 },
          anchor: [0.5, 1]
        }
      },
      localFrame: 0,
      transform: {
        x: 0,
        y: scene.height / 2 - margin,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        opacity: 1,
        anchorX: 0.5,
        anchorY: 1
      },
      crop: { left: 0, top: 0, right: 0, bottom: 0 },
      blendMode: 'normal',
      effects: []
    }
  }

  // ── Texture caches ──────────────────────────────────────────────────────────────────────────────

  private newCached(map: Map<Id, CachedTexture>, key: Id): CachedTexture {
    const cached: CachedTexture = {
      texture: createTexture(this.gl),
      width: 0,
      height: 0,
      lastUsed: this.tick,
      stamp: null
    }
    map.set(key, cached)
    return cached
  }

  /** Media is fitted ("contain") into the project frame; scale 1 therefore always means "fills the frame". */
  private fitted(cached: CachedTexture, w: number, h: number): CachedTexture {
    const W = this.width / this.scale
    const H = this.height / this.scale
    const s = Math.min(W / w, H / h)
    cached.width = w * s
    cached.height = h * s
    cached.lastUsed = this.tick
    return cached
  }

  private rasterTexture(key: string, build: () => Raster): CachedTexture {
    let cached = this.rasterTextures.get(key)
    if (!cached) {
      const raster = build()
      cached = this.newCached(this.rasterTextures, key)
      this.gl.bindTexture(this.gl.TEXTURE_2D, cached.texture)
      this.gl.texImage2D(
        this.gl.TEXTURE_2D,
        0,
        this.gl.RGBA,
        this.gl.RGBA,
        this.gl.UNSIGNED_BYTE,
        raster.canvas
      )
      cached.width = raster.width
      cached.height = raster.height
    }
    cached.lastUsed = this.tick
    return cached
  }

  private evictRasters(): void {
    if (this.rasterTextures.size <= MAX_RASTERS) return
    const entries = [...this.rasterTextures.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)
    for (const [key, cached] of entries.slice(0, entries.length - MAX_RASTERS)) {
      this.gl.deleteTexture(cached.texture)
      this.rasterTextures.delete(key)
    }
  }

  // ── GL plumbing ─────────────────────────────────────────────────────────────────────────────────

  private createTarget(): Target {
    const { gl } = this
    const texture = createTexture(gl)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.width, this.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    const framebuffer = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
    return { framebuffer, texture }
  }

  private bind(target: Target): void {
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, target.framebuffer)
    this.gl.viewport(0, 0, this.width, this.height)
  }

  private cleared(target: Target): Target {
    this.bind(target)
    this.gl.clearColor(0, 0, 0, 0)
    this.gl.clear(this.gl.COLOR_BUFFER_BIT)
    return target
  }

  private use(name: string, vertex: string, fragment: string): Program {
    const { gl } = this
    let entry = this.programs.get(name)
    if (!entry) {
      const program = compileProgram(gl, vertex, fragment)
      const uniforms = new Map<string, WebGLUniformLocation | null>()
      const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number
      for (let i = 0; i < count; i++) {
        const info = gl.getActiveUniform(program, i)
        if (info) uniforms.set(info.name, gl.getUniformLocation(program, info.name))
      }
      entry = { program, uniforms }
      this.programs.set(name, entry)
    }
    gl.useProgram(entry.program)
    return entry
  }

  private texture(program: Program, uniform: string, unit: number, texture: WebGLTexture): void {
    const { gl } = this
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.uniform1i(program.uniforms.get(uniform)!, unit)
    gl.activeTexture(gl.TEXTURE0)
  }

  private drawFullscreen(program: Program, flipY = 1): void {
    this.gl.uniform1f(program.uniforms.get('u_flipY')!, flipY)
    this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4)
  }
}
