import { effectSpec, TRANSITIONS } from '@core/index'
import type { CaptionClip, Id, Layer, Lut3D, ResolvedEffect, Scene, SceneNode } from '@core/index'
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
  /** A parsed `.cube` file, or null while it loads (the effect is skipped until then). */
  lut(path: string): Lut3D | null
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
  /** Timeline frame being rendered (seeds animated noise). */
  private frame = 0

  private readonly programs = new Map<string, Program>()
  private targets: Target[] = []
  private readonly layerTextures = new Map<Id, CachedTexture>()
  private readonly imageTextures = new Map<Id, CachedTexture>()
  private readonly rasterTextures = new Map<string, CachedTexture>()
  private readonly lutTextures = new Map<string, CachedTexture>()
  /** Clips whose upload failed, so the error is logged once instead of every frame. */
  private readonly failedClips = new Set<Id>()

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

    this.initState()
    // A GPU reset or driver hiccup loses the context; recover instead of showing a dead canvas.
    if ('addEventListener' in canvas) {
      canvas.addEventListener('webglcontextlost', this.onContextLost)
      canvas.addEventListener('webglcontextrestored', this.onContextRestored)
    }
  }

  /** Called after a lost context came back and everything was rebuilt; repaint now. */
  onRestored?: () => void
  private lost = false

  private readonly onContextLost = (event: Event): void => {
    // Without preventDefault the browser never restores the context.
    event.preventDefault()
    this.lost = true
  }

  private readonly onContextRestored = (): void => {
    this.lost = false
    this.forgetResources()
    this.initState()
    this.onRestored?.()
  }

  private initState(): void {
    const { gl } = this
    const vao = gl.createVertexArray()
    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
    gl.disable(gl.DEPTH_TEST)
  }

  /** Drops every handle without touching GL (they died with the context) so they are recreated lazily. */
  private forgetResources(): void {
    this.programs.clear()
    this.targets = []
    this.layerTextures.clear()
    this.imageTextures.clear()
    this.rasterTextures.clear()
    this.lutTextures.clear()
    this.width = 0
    this.height = 0
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
    this.targets = Array.from({ length: 8 }, () => this.createTarget())
  }

  render(scene: Scene, source: FrameSource): void {
    const { gl } = this
    if (this.lost || gl.isContextLost()) return
    this.tick++
    this.frame = scene.frame
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
      let opacity = 1
      if (node.kind === 'layer') {
        result = this.renderLayer(node, source, layerA, layerB)
        blendMode = node.blendMode
      } else if (node.kind === 'adjustment') {
        if (node.opacity <= 0 || node.effects.length === 0) return
        // The effects run on a copy of everything below, which is then laid back on top.
        this.bind(layerA)
        const copy = this.use('copy', FULLSCREEN_VERTEX, COPY_FRAGMENT)
        this.texture(copy, 'u_tex', 0, accRead.texture)
        this.drawFullscreen(copy)
        result = this.applyEffects(node.effects, layerA, layerB, source)
        blendMode = 'normal'
        opacity = node.opacity
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
      gl.uniform1f(p.uniforms.get('u_opacity')!, opacity)
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

  /** Drops rasterised text and shapes, e.g. once a web font finished loading. */
  clearRasters(): void {
    for (const cached of this.rasterTextures.values()) this.gl.deleteTexture(cached.texture)
    this.rasterTextures.clear()
  }

  forgetClip(clipId: Id): void {
    const cached = this.layerTextures.get(clipId)
    if (cached) this.gl.deleteTexture(cached.texture)
    this.layerTextures.delete(clipId)
  }

  /**
   * Frees GPU memory but keeps the context alive: a canvas hands out the same context for its whole
   * life, so killing it would break any later Compositor on this canvas (React StrictMode remounts).
   */
  dispose(): void {
    const { gl } = this
    if ('removeEventListener' in this.canvas) {
      this.canvas.removeEventListener('webglcontextlost', this.onContextLost)
      this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored)
    }
    for (const { program } of this.programs.values()) gl.deleteProgram(program)
    for (const target of this.targets) {
      gl.deleteFramebuffer(target.framebuffer)
      gl.deleteTexture(target.texture)
    }
    for (const cache of [this.layerTextures, this.imageTextures, this.rasterTextures, this.lutTextures]) {
      for (const cached of cache.values()) gl.deleteTexture(cached.texture)
    }
    this.forgetResources()
  }

  // ── Layers ──────────────────────────────────────────────────────────────────────────────────────

  /** Draws a layer plus its effects. Returns the target holding the result (`primary` or `scratch`). */
  private renderLayer(layer: Layer, source: FrameSource, primary: Target, scratch: Target): Target | null {
    let content: CachedTexture | null = null
    try {
      content = this.layerContent(layer, source)
    } catch (error) {
      // One layer that cannot be uploaded must not take the whole frame down with it.
      if (!this.failedClips.has(layer.clip.id))
        console.error(`[compositor] cannot draw "${layer.clip.name}"`, error)
      this.failedClips.add(layer.clip.id)
    }
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

    return this.applyEffects(layer.effects, primary, scratch, source)
  }

  /**
   * Runs an effect stack. `read` holds the input and `write` is free; they swap after every pass, and
   * the one holding the result is returned. Multi-pass effects (glow, shadow) also use the two
   * effect scratch targets, which nothing else touches.
   */
  private applyEffects(effects: ResolvedEffect[], read: Target, write: Target, source: FrameSource): Target {
    const { gl } = this
    const [fxA, fxB] = [this.targets[6]!, this.targets[7]!]
    const pixels = (value: number | undefined): number => (value ?? 0) * this.scale
    /** One pass from `input` into `output`. */
    const run = (
      type: string,
      params: Record<string, number>,
      input: WebGLTexture,
      output: Target,
      setup?: (p: Program) => void
    ): void => {
      const fragment = EFFECT_FRAGMENTS[type]
      if (!fragment) return
      this.bind(output)
      const program = this.use(`effect:${type}`, FULLSCREEN_VERTEX, fragment)
      this.texture(program, 'u_tex', 0, input)
      gl.uniform2f(program.uniforms.get('u_texel')!, 1 / this.width, 1 / this.height)
      const seed = program.uniforms.get('u_seed')
      if (seed) gl.uniform1f(seed, this.frame)
      for (const [key, value] of Object.entries(params)) {
        const location = program.uniforms.get(key)
        if (location) gl.uniform1f(location, value)
      }
      setup?.(program)
      this.drawFullscreen(program)
    }
    /** A pass over the stack's current image. */
    const pass = (type: string, params: Record<string, number>, setup?: (p: Program) => void): void => {
      run(type, params, read.texture, write, setup)
      ;[read, write] = [write, read]
    }
    const direction = (x: number, y: number) => (p: Program) =>
      gl.uniform2f(p.uniforms.get('u_direction')!, x, y)
    /** Gaussian blur of fxA in place (through fxB). */
    const blurScratch = (radius: number): void => {
      run('blur', { radius }, fxA.texture, fxB, direction(1, 0))
      run('blur', { radius }, fxB.texture, fxA, direction(0, 1))
    }

    for (const effect of effects) {
      const p = effect.params
      switch (effect.type) {
        case 'blur': {
          const params = { radius: pixels(p['radius']) }
          pass('blur', params, direction(1, 0))
          pass('blur', params, direction(0, 1))
          break
        }
        case 'glow':
          run('glowExtract', { threshold: p['threshold'] ?? 0.7 }, read.texture, fxA)
          blurScratch(pixels(p['radius']))
          pass('glowCombine', { intensity: p['intensity'] ?? 1 }, (pr) =>
            this.texture(pr, 'u_glow', 1, fxA.texture)
          )
          break
        case 'dropShadow': {
          const angle = ((p['angle'] ?? 45) * Math.PI) / 180
          const distance = pixels(p['distance'])
          run('shadowShape', { opacity: p['opacity'] ?? 0.6 }, read.texture, fxA, (pr) =>
            gl.uniform2f(pr.uniforms.get('u_offset')!, Math.cos(angle) * distance, Math.sin(angle) * distance)
          )
          blurScratch(pixels(p['blur']))
          pass('shadowCombine', {}, (pr) => this.texture(pr, 'u_shadow', 1, fxA.texture))
          break
        }
        case 'lut': {
          const lut = effect.resource ? source.lut(effect.resource) : null
          if (!lut) break
          const texture = this.lutTexture(effect.resource!, lut)
          pass('lut', { intensity: p['intensity'] ?? 1 }, (pr) => {
            gl.activeTexture(gl.TEXTURE1)
            gl.bindTexture(gl.TEXTURE_3D, texture)
            gl.uniform1i(pr.uniforms.get('u_lut')!, 1)
            gl.activeTexture(gl.TEXTURE0)
            gl.uniform1f(pr.uniforms.get('u_lutSize')!, lut.size)
            gl.uniform3f(pr.uniforms.get('u_domainMin')!, ...lut.domainMin)
            gl.uniform3f(pr.uniforms.get('u_domainMax')!, ...lut.domainMax)
          })
          break
        }
        default: {
          const spec = effectSpec(effect.type)
          const params = { ...p }
          // Pixel sizes are in project pixels; the preview may render smaller.
          for (const [key, param] of Object.entries(spec?.params ?? {})) {
            if (param.pixels) params[key] = pixels(p[key])
          }
          pass(effect.type, params)
        }
      }
    }
    return read
  }

  /** The 3D texture of a LUT, uploaded once per file (and again if the file's contents change). */
  private lutTexture(path: string, lut: Lut3D): WebGLTexture {
    const cached = this.lutTextures.get(path)
    if (cached && cached.stamp === lut) return cached.texture
    const { gl } = this
    const texture = cached?.texture ?? gl.createTexture()
    gl.bindTexture(gl.TEXTURE_3D, texture)
    // 3D uploads refuse the premultiply flag the 2D uploads use.
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB16F, lut.size, lut.size, lut.size, 0, gl.RGB, gl.FLOAT, lut.data)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
    for (const wrap of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R])
      gl.texParameteri(gl.TEXTURE_3D, wrap, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    this.lutTextures.set(path, {
      texture,
      width: lut.size,
      height: lut.size,
      lastUsed: this.tick,
      stamp: lut
    })
    return texture
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
