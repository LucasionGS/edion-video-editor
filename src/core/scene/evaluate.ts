import { evaluate } from '../keyframes/animatable'
import { animationAt } from '../keyframes/presets'
import type {
  AdjustmentClip,
  AudibleClip,
  BlendMode,
  CaptionClip,
  Clip,
  Crop,
  Effect,
  Id,
  Project,
  TextClip,
  TextStyle,
  Track,
  Transition,
  VisualClip
} from '../model/types'
import { isAudibleClip, isVisualClip } from '../model/types'
import { clipEnd, findMedia, hasRamp, sourceTimeAt } from '../ops/query'

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
  /** A file the effect needs (a LUT), if any. */
  resource?: string
}

export interface Layer {
  kind: 'layer'
  clip: VisualClip
  /** Text being typed on: how many of its letters (not counting spaces) show. Absent = all. */
  reveal?: number
  /** For a compound clip: its sequence at this frame, drawn as the layer's picture. */
  nested?: Scene
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

/** An adjustment layer: its effects run on everything composited so far. */
export interface AdjustmentNode {
  kind: 'adjustment'
  clip: AdjustmentClip
  localFrame: number
  opacity: number
  effects: ResolvedEffect[]
}

export type SceneNode = Layer | TransitionNode | AdjustmentNode

/** The clip layers a node draws (none for an adjustment layer). */
export const layersOf = (node: SceneNode): Layer[] =>
  node.kind === 'layer' ? [node] : node.kind === 'transition' ? [node.from, node.to] : []

/** A caption on screen, with its animation resolved for this frame. */
export interface CaptionNode {
  clip: CaptionClip
  /** Letters (spaces not counted) showing while it types on; absent = all. */
  reveal?: number
  opacity: number
}

export interface Scene {
  frame: number
  width: number
  height: number
  background: string
  /** Back to front. */
  nodes: SceneNode[]
  captions: CaptionNode[]
  captionStyle: TextStyle
}

const NO_CROP: Crop = { left: 0, top: 0, right: 0, bottom: 0 }

function resolveEffects(effects: Effect[], localFrame: number): ResolvedEffect[] {
  return effects
    .filter((e) => e.enabled)
    .map((e) => ({
      type: e.type,
      params: Object.fromEntries(Object.entries(e.params).map(([k, v]) => [k, evaluate(v, localFrame)])),
      ...(e.resource ? { resource: e.resource } : {})
    }))
}

function resolveLayer(project: Project, clip: VisualClip, frame: number): Layer {
  const localFrame = frame - clip.start
  const { position, scale, rotation, opacity, anchor } = clip.transform
  const animated = animationAt(clip, localFrame, project.settings)
  const [x, y] = evaluate(position, localFrame).map((v, i) => v + (i ? animated.dy : animated.dx)) as [
    number,
    number
  ]
  const [scaleX, scaleY] = evaluate(scale, localFrame).map((v) => v * animated.scale) as [number, number]
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
      opacity: Math.max(0, Math.min(1, evaluate(opacity, localFrame) * animated.opacity)),
      anchorX: anchor[0],
      anchorY: anchor[1]
    },
    crop: 'crop' in clip ? clip.crop : NO_CROP,
    blendMode: clip.blendMode,
    effects: resolveEffects(clip.effects, localFrame)
  }
  if (clip.type === 'text') {
    const reveal = revealedLetters(clip, localFrame, project.settings.fps)
    if (reveal !== undefined) layer.reveal = reveal
  }
  if (clip.type === 'video') {
    const media = findMedia(project, clip.mediaId)
    const time = sourceTimeAt(clip, localFrame, project.settings.fps)
    // Inside a transition a clip plays past its edges; hold the first/last frame when the source runs out.
    const lastFrameTime = Math.max(0, (media?.duration ?? 0) - 1 / (media?.fps ?? project.settings.fps))
    layer.sourceTime = Math.max(0, Math.min(time, lastFrameTime))
  }
  return layer
}

function captionNode(project: Project, clip: CaptionClip, frame: number): CaptionNode {
  const animation = project.captionAnimation
  const local = frame - clip.start
  const fade = Math.min(animation?.fade ?? 0, Math.floor(clip.duration / 2))
  const opacity = fade > 0 ? Math.max(0, Math.min(1, (local + 1) / fade, (clip.duration - local) / fade)) : 1
  const node: CaptionNode = { clip, opacity }
  if (animation?.reveal) {
    const reveal = revealedLetters({ text: clip.text, reveal: animation.reveal }, local, project.settings.fps)
    if (reveal !== undefined) node.reveal = reveal
  }
  return node
}

/** Letters (spaces not counted) of a text clip showing at a clip-relative frame, when it types on. */
export function revealedLetters(
  clip: Pick<TextClip, 'text' | 'reveal'>,
  localFrame: number,
  fps: number
): number | undefined {
  if (!clip.reveal) return undefined
  const progress = Math.max(0, Math.min(1, localFrame / Math.max(1, clip.reveal.seconds * fps)))
  const words = clip.text.split(/\s+/).filter(Boolean)
  const letters = words.reduce((sum, w) => sum + [...w].length, 0)
  if (clip.reveal.mode === 'letters') return Math.floor(progress * letters + 1e-9)
  const shown = Math.floor(progress * words.length + 1e-9)
  return words.slice(0, shown).reduce((sum, w) => sum + [...w].length, 0)
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
  return evaluateTracks(project, project.tracks, frame, project.settings.background, 0)
}

/** Nested sequences deeper than this are not drawn (they cannot be built by the app anyway). */
const MAX_NESTING = 8

function evaluateTracks(
  project: Project,
  tracks: readonly Track[],
  frame: number,
  background: string,
  depth: number
): Scene {
  const { width, height } = project.settings
  const scene: Scene = {
    frame,
    width,
    height,
    background,
    nodes: [],
    captions: [],
    captionStyle: project.captionStyle
  }
  const resolve = (clip: VisualClip, at: number): Layer => {
    const layer = resolveLayer(project, clip, at)
    if (clip.type === 'compound' && depth < MAX_NESTING) {
      const sequence = project.sequences?.find((s) => s.id === clip.sequenceId)
      // Transparent, so what lies below the compound clip shows through its empty parts.
      if (sequence)
        layer.nested = evaluateTracks(
          project,
          sequence.tracks,
          layer.localFrame + clip.offset,
          'transparent',
          depth + 1
        )
    }
    return layer
  }

  // tracks[0] is the top of the timeline, so walk backwards to paint back to front.
  for (let i = tracks.length - 1; i >= 0; i--) {
    const track = tracks[i]!
    if (track.hidden) continue
    if (track.kind === 'caption') {
      const caption = track.clips.find((c) => frame >= c.start && frame < clipEnd(c) && !c.disabled)
      if (caption?.type === 'caption') scene.captions.push(captionNode(project, caption, frame))
      continue
    }
    if (track.kind !== 'video') continue

    const active = transitionAt(track, frame)
    if (
      active &&
      isVisualClip(active.from) &&
      isVisualClip(active.to) &&
      !active.from.disabled &&
      !active.to.disabled
    ) {
      const { transition, from, to } = active
      const begin = to.start - transition.duration / 2
      scene.nodes.push({
        kind: 'transition',
        type: transition.type,
        progress: (frame - begin + 0.5) / transition.duration,
        from: resolve(from, frame),
        to: resolve(to, frame)
      })
      continue
    }
    const clip = track.clips.find((c) => frame >= c.start && frame < clipEnd(c) && !c.disabled)
    if (clip && isVisualClip(clip)) scene.nodes.push(resolve(clip, frame))
    else if (clip?.type === 'adjustment') {
      const localFrame = frame - clip.start
      scene.nodes.push({
        kind: 'adjustment',
        clip,
        localFrame,
        opacity: Math.max(0, Math.min(1, evaluate(clip.opacity, localFrame))),
        effects: resolveEffects(clip.effects, localFrame)
      })
    }
  }
  return scene
}

/** Every clip layer drawn in a scene, including the ones inside compound clips (for decoding). */
export function allLayers(scene: Scene): Layer[] {
  return scene.nodes
    .flatMap(layersOf)
    .flatMap((layer) => [layer, ...(layer.nested ? allLayers(layer.nested) : [])])
}

// ── Audio ─────────────────────────────────────────────────────────────────────────────────────────

export interface AudioSource {
  clip: AudibleClip
  trackId: Id
  mediaId: Id
  /**
   * Frames the clip keeps sounding before its start and after its end: half of a transition on that cut,
   * during which it crossfades with its neighbour.
   */
  crossIn: number
  crossOut: number
  /** For clips inside compound clips: the timeline frames it may sound in, and the compound's gain. */
  bounds?: [number, number]
  gain?: number
}

/** Every clip that produces sound, honouring mute/solo; clips inside compound clips are placed on the timeline. */
export function collectAudioSources(project: Project): AudioSource[] {
  return collectFrom(project, project.tracks, { shift: 0, bounds: null, gain: 1, trackId: null }, 0)
}

interface Placement {
  /** Timeline frame of the sequence's frame 0. */
  shift: number
  bounds: [number, number] | null
  gain: number
  /** The top-level track, whose volume and pan apply. */
  trackId: Id | null
}

function collectFrom(
  project: Project,
  tracks: readonly Track[],
  place: Placement,
  depth: number
): AudioSource[] {
  const anySolo = tracks.some((t) => t.solo)
  const sources: AudioSource[] = []
  for (const track of tracks) {
    if (track.muted || (anySolo && !track.solo)) continue
    for (const clip of track.clips) {
      if (clip.disabled) continue
      if (clip.type === 'compound' && depth < MAX_NESTING) {
        const sequence = project.sequences?.find((s) => s.id === clip.sequenceId)
        if (!sequence || clip.volume <= 0) continue
        const start = place.shift + clip.start
        const bounds: [number, number] = [start, start + clip.duration]
        sources.push(
          ...collectFrom(
            project,
            sequence.tracks,
            {
              shift: start - clip.offset,
              bounds: place.bounds
                ? [Math.max(bounds[0], place.bounds[0]), Math.min(bounds[1], place.bounds[1])]
                : bounds,
              gain: place.gain * clip.volume,
              trackId: place.trackId ?? track.id
            },
            depth + 1
          )
        )
        continue
      }
      if (!isAudibleClip(clip)) continue
      // Frame holds and speed-ramped clips are silent.
      if (clip.type === 'video' && (clip.audioMuted || clip.hold || hasRamp(clip))) continue
      const into = track.transitions.find((t) => t.rightClipId === clip.id)
      const out = track.transitions.find((t) => t.leftClipId === clip.id)
      const source: AudioSource = {
        clip: place.shift ? { ...clip, start: clip.start + place.shift } : clip,
        trackId: place.trackId ?? track.id,
        mediaId: clip.mediaId,
        crossIn: into ? into.duration / 2 : 0,
        crossOut: out ? out.duration / 2 : 0
      }
      if (place.bounds) {
        if (source.clip.start + source.clip.duration + source.crossOut <= place.bounds[0]) continue
        if (source.clip.start - source.crossIn >= place.bounds[1]) continue
        source.bounds = place.bounds
      }
      if (place.gain !== 1) source.gain = place.gain
      sources.push(source)
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

/**
 * Gain of a source at a clip-relative frame, including the equal-power crossfades of transitions:
 * across a transition the outgoing clip follows cos and the incoming one sin, so the loudness stays even.
 * Outside the clip (and its crossfade overhang) it is silent.
 */
export function sourceGainAt(source: AudioSource, localFrame: number): number {
  const { clip, crossIn, crossOut, bounds } = source
  if (localFrame < -crossIn || localFrame > clip.duration + crossOut) return 0
  if (bounds && (clip.start + localFrame < bounds[0] || clip.start + localFrame > bounds[1])) return 0
  let gain = gainAt(clip, Math.max(0, Math.min(clip.duration, localFrame)))
  if (crossIn > 0) {
    const t = (localFrame + crossIn) / (2 * crossIn)
    if (t < 1) gain *= Math.sin(Math.max(0, t) * (Math.PI / 2))
  }
  if (crossOut > 0) {
    const t = (localFrame - (clip.duration - crossOut)) / (2 * crossOut)
    if (t > 0) gain *= Math.cos(Math.min(1, t) * (Math.PI / 2))
  }
  return gain * (source.gain ?? 1)
}
