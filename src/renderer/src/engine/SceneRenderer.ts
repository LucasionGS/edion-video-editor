import { allLayers, evaluateScene, findMedia } from '@core/index'
import type { Id, Layer, Lut3D, Project, Scene } from '@core/index'
import type { EdionApi } from '@shared/ipc'
import { Compositor, type FrameSource } from './compositor/Compositor'
import { ClipVideoDecoder } from './decode/ClipVideoDecoder'
import { ImageStore } from './decode/ImageStore'
import { LutStore } from './decode/LutStore'
import { MediaPool, type ProxyProvider } from './decode/MediaPool'

/** The slice of the preload API the engine needs; both the editor and the export window provide it. */
export interface EngineApi {
  media: EdionApi['media']
  proxies?: ProxyProvider
}

const MAX_IDLE_DECODERS = 4

interface DecoderSlot {
  decoder: Promise<ClipVideoDecoder | null>
  ready: ClipVideoDecoder | null
  path: string
  lastUsed: number
}

/**
 * Feeds the compositor: owns the per-clip decoders and stills. `draw` is the non-blocking
 * preview path, `drawExact` the frame-perfect export path; both render the same Scene.
 */
export class SceneRenderer implements FrameSource {
  readonly compositor: Compositor
  readonly pool: MediaPool
  private readonly images: ImageStore
  private readonly luts: LutStore
  private readonly slots = new Map<Id, DecoderSlot>()
  private project: Project | null = null
  private tick = 0
  /** Set whenever new pixels arrived for the frame on screen. */
  onContentReady?: () => void

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas, api: EngineApi, flipOutput = false) {
    this.compositor = new Compositor(canvas, flipOutput)
    this.compositor.onRestored = () => this.onContentReady?.()
    this.pool = new MediaPool(api.media, api.proxies)
    this.images = new ImageStore(api.media, () => this.onContentReady?.())
    this.luts = new LutStore(api.media, () => this.onContentReady?.())
  }

  // FrameSource
  videoFrame(layer: Layer): VideoFrame | null {
    return this.slots.get(layer.clip.id)?.ready?.current ?? null
  }
  image(mediaId: Id): ImageBitmap | null {
    const media = this.project && findMedia(this.project, mediaId)
    return media ? this.images.get(media.path) : null
  }
  lut(path: string): Lut3D | null {
    return this.luts.get(path)
  }

  /** Preview: request frames, draw what is available now. Missing frames trigger `onContentReady` later. */
  draw(project: Project, frame: number): Scene {
    const scene = this.prepare(project, frame)
    for (const layer of allLayers(scene)) {
      if (layer.clip.type === 'video') this.slot(layer)?.ready?.request(layer.sourceTime ?? 0)
    }
    this.compositor.render(scene, this)
    this.evict()
    return scene
  }

  /** Export: waits until every layer has exactly the right frame. */
  async drawExact(project: Project, frame: number): Promise<Scene> {
    const scene = this.prepare(project, frame)
    await Promise.all(effectResources(scene).map((path) => this.luts.load(path)))
    await Promise.all(
      allLayers(scene).map(async (layer) => {
        if (layer.clip.type === 'video')
          await (await this.slot(layer)?.decoder)?.frameAt(layer.sourceTime ?? 0)
        if (layer.clip.type === 'image') {
          const media = findMedia(project, layer.clip.mediaId)
          if (media) await this.images.load(media.path)
        }
      })
    )
    this.compositor.render(scene, this)
    this.evict()
    return scene
  }

  /** Warms up the decoder of a clip that is about to start, so playback doesn't hitch on the cut. */
  preroll(project: Project, frame: number): void {
    const scene = evaluateScene(project, frame)
    this.project = project
    for (const layer of allLayers(scene)) {
      if (layer.clip.type !== 'video') continue
      const slot = this.slot(layer)
      if (slot && !slot.ready?.current)
        void slot.decoder.then((d) => !d?.current && d?.request(layer.sourceTime ?? 0))
    }
  }

  private prepare(project: Project, frame: number): Scene {
    this.project = project
    this.tick++
    return evaluateScene(project, frame)
  }

  private slot(layer: Layer): DecoderSlot | null {
    const { clip } = layer
    if (clip.type !== 'video' || !this.project) return null
    const media = findMedia(this.project, clip.mediaId)
    if (!media) return null
    let slot = this.slots.get(clip.id)
    if (slot && slot.path !== media.path) {
      this.release(clip.id)
      slot = undefined
    }
    if (!slot) {
      const fps = media.fps ?? this.project.settings.fps
      const created: DecoderSlot = {
        path: media.path,
        lastUsed: this.tick,
        ready: null,
        decoder: this.pool.open(media.path).then((open) => {
          if (!open?.video || !open.videoDecodable) return null
          created.ready = new ClipVideoDecoder(open.video, fps, () => this.onContentReady?.())
          return created.ready
        })
      }
      slot = created
      this.slots.set(clip.id, slot)
      void slot.decoder.then((d) => d?.request(layer.sourceTime ?? 0))
    }
    slot.lastUsed = this.tick
    return slot
  }

  private release(clipId: Id): void {
    const slot = this.slots.get(clipId)
    this.slots.delete(clipId)
    this.compositor.forgetClip(clipId)
    void slot?.decoder.then((d) => d?.dispose())
  }

  /** Decoders hold GPU frames and a codec instance each, so only a few idle ones are kept warm. */
  private evict(): void {
    const idle = [...this.slots.entries()]
      .filter(([, s]) => s.lastUsed < this.tick)
      .sort((a, b) => b[1].lastUsed - a[1].lastUsed)
    for (const [clipId] of idle.slice(MAX_IDLE_DECODERS)) this.release(clipId)
  }

  /** Drops everything opened for a media file, so it is reopened (e.g. from its new proxy) on the next draw. */
  resetMedia(path: string): void {
    for (const [clipId, slot] of [...this.slots.entries()]) if (slot.path === path) this.release(clipId)
    this.pool.forget(path)
    this.onContentReady?.()
  }

  dispose(): void {
    for (const clipId of [...this.slots.keys()]) this.release(clipId)
    this.pool.dispose()
    this.compositor.dispose()
  }
}

/** Files (LUTs) the effects in a scene need, including inside compound clips. */
function effectResources(scene: Scene): string[] {
  return scene.nodes.flatMap((node) => {
    const layers =
      node.kind === 'adjustment' ? [] : node.kind === 'transition' ? [node.from, node.to] : [node]
    const own = node.kind === 'adjustment' ? node.effects : layers.flatMap((l) => l.effects)
    return [
      ...own.flatMap((e) => e.resource ?? []),
      ...layers.flatMap((l) => (l.nested ? effectResources(l.nested) : []))
    ]
  })
}
