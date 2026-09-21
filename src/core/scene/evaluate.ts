import { evaluate } from '../keyframes/animatable'
import type {
  AudibleClip,
  BlendMode,
  CaptionClip,
  Clip,
  Crop,
  Id,
  Project,
  Track,
  Transition,
  VisualClip
} from '../model/types'
import { isAudibleClip, isVisualClip } from '../model/types'
import { clipEnd, findMedia } from '../ops/query'

/**
 * Turns (project, frame) into a flat, fully resolved description of what to draw.
 * Preview and export both render exactly this, which is what keeps them identical.
 */

export interface ResolvedTransform {
  x: number
  y: number
  scaleX: number
  scaleY: number
  rotation: number
  opacity: number
  anchorX: number
  anchorY: number
}

export interface ResolvedEffect {
  type: string
  params: Record<string, number>
}

export interface Layer {
  kind: 'layer'
  clip: VisualClip
  /** Frame relative to the clip start. Can fall outside [0, duration) inside a transition. */
  localFrame: number
  /** Position in the source media in seconds (video only). */
  sourceTime?: number
  transform: ResolvedTransform
  crop: Crop
  blendMode: BlendMode
  effects: ResolvedEffect[]
}

export interface TransitionNode {
  kind: 'transition'
  type: string
  /** 0 → only `from` visible, 1 → only `to` visible. */
  progress: number
  from: Layer
  to: Layer
}

export type SceneNode = Layer | TransitionNode

export interface Scene {
  frame: number
  width: number
  height: number
  background: string
  /** Back to front. */
  nodes: SceneNode[]
  captions: CaptionClip[]
}

const NO_CROP: Crop = { left: 0, top: 0, right: 0, bottom: 0 }

function resolveLayer(project: Project, clip: VisualClip, frame: number): Layer {
  const localFrame = frame - clip.start
  const { position, scale, rotation, opacity, anchor } = clip.transform
  const [x, y] = evaluate(position, localFrame)
  const [scaleX, scaleY] = evaluate(scale, localFrame)
  const layer: Layer = {
    kind: 'layer',
    clip,
    localFrame,
    transform: {
      x,
      y,
      scaleX,
      scaleY,
      rotation: evaluate(rotation, localFrame),
      opacity: Math.max(0, Math.min(1, evaluate(opacity, localFrame))),
      anchorX: anchor[0],
      anchorY: anchor[1]
    },
    crop: 'crop' in clip ? clip.crop : NO_CROP,
    blendMode: clip.blendMode,
    effects: clip.effects
      .filter((e) => e.enabled)
      .map((e) => ({
        type: e.type,
        params: Object.fromEntries(Object.entries(e.params).map(([k, v]) => [k, evaluate(v, localFrame)]))
      }))
  }
  if (clip.type === 'video') {
    const media = findMedia(project, clip.mediaId)
    const time = clip.sourceIn + (localFrame / project.settings.fps) * clip.speed
    // Inside a transition a clip plays past its edges; hold the first/last frame when the source runs out.
    const lastFrameTime = Math.max(0, (media?.duration ?? 0) - 1 / (media?.fps ?? project.settings.fps))
    layer.sourceTime = Math.max(0, Math.min(time, lastFrameTime))
  }
  return layer
}

function transitionAt(track: Track, frame: number): { transition: Transition; from: Clip; to: Clip } | null {
  for (const transition of track.transitions) {
    const from = track.clips.find((c) => c.id === transition.leftClipId)
    const to = track.clips.find((c) => c.id === transition.rightClipId)
    if (!from || !to) continue
    const half = transition.duration / 2
    if (frame >= to.start - half && frame < to.start + half) return { transition, from, to }
  }
  return null
}

export function evaluateScene(project: Project, frame: number): Scene {
  const { width, height, background } = project.settings
  const scene: Scene = { frame, width, height, background, nodes: [], captions: [] }

  // tracks[0] is the top of the timeline, so walk backwards to paint back to front.
  for (let i = project.tracks.length - 1; i >= 0; i--) {
    const track = project.tracks[i]!
    if (track.hidden) continue
    if (track.kind === 'caption') {
      const caption = track.clips.find((c) => frame >= c.start && frame < clipEnd(c))
      if (caption?.type === 'caption') scene.captions.push(caption)
      continue
    }
    if (track.kind !== 'video') continue

    const active = transitionAt(track, frame)
    if (active && isVisualClip(active.from) && isVisualClip(active.to)) {
      const { transition, from, to } = active
      const begin = to.start - transition.duration / 2
      scene.nodes.push({
        kind: 'transition',
        type: transition.type,
        progress: (frame - begin + 0.5) / transition.duration,
        from: resolveLayer(project, from, frame),
        to: resolveLayer(project, to, frame)
      })
      continue
    }
    const clip = track.clips.find((c) => frame >= c.start && frame < clipEnd(c))
    if (clip && isVisualClip(clip)) scene.nodes.push(resolveLayer(project, clip, frame))
  }
  return scene
}

// ── Audio ─────────────────────────────────────────────────────────────────────────────────────────

export interface AudioSource {
  clip: AudibleClip
  trackId: Id
  mediaId: Id
}

/** Every clip that produces sound, honouring mute/solo. */
export function collectAudioSources(project: Project): AudioSource[] {
  const anySolo = project.tracks.some((t) => t.solo)
  const sources: AudioSource[] = []
  for (const track of project.tracks) {
    if (track.muted || (anySolo && !track.solo)) continue
    for (const clip of track.clips) {
      if (!isAudibleClip(clip)) continue
      if (clip.type === 'video' && clip.audioMuted) continue
      sources.push({ clip, trackId: track.id, mediaId: clip.mediaId })
    }
  }
  return sources
}

/** Linear gain of a clip at a clip-relative frame: keyframed volume shaped by the fades. */
export function gainAt(clip: AudibleClip, localFrame: number): number {
  let gain = Math.max(0, evaluate(clip.volume, localFrame))
  if (clip.fadeIn > 0 && localFrame < clip.fadeIn) gain *= Math.max(0, localFrame / clip.fadeIn)
  const remaining = clip.duration - localFrame
  if (clip.fadeOut > 0 && remaining < clip.fadeOut) gain *= Math.max(0, remaining / clip.fadeOut)
  return gain
}
