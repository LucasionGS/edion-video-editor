import { newId, createTextClip } from '../model/factory'
import type {
  Animatable,
  AnimValue,
  BlendMode,
  Effect,
  TextClip,
  TextStyle,
  Transform,
  Vec2
} from '../model/types'

/**
 * Text looks: everything about a text clip except its words and timing — style, wrap width, type-on,
 * position and animation, blend mode and effects — so it can be saved under a name and reused.
 */

/** A keyframe in a saved look. Keyframes in the second half of the clip are kept relative to its end. */
export interface LookKeyframe<T> {
  frame: number
  fromEnd?: boolean
  value: T
  easing: NonNullable<Animatable<T>['keyframes']>[number]['easing']
}
export interface LookAnimatable<T> {
  value: T
  keyframes?: LookKeyframe<T>[]
}

export interface TextLook {
  style: TextStyle
  boxWidth: number
  reveal?: TextClip['reveal']
  transform: {
    position: LookAnimatable<Vec2>
    scale: LookAnimatable<Vec2>
    rotation: LookAnimatable<number>
    opacity: LookAnimatable<number>
    anchor: Vec2
  }
  blendMode: BlendMode
  effects: Array<Omit<Effect, 'id'>>
}

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

function storeAnimatable<T extends AnimValue>(anim: Animatable<T>, duration: number): LookAnimatable<T> {
  const stored: LookAnimatable<T> = { value: copy(anim.value) }
  if (anim.keyframes?.length) {
    stored.keyframes = anim.keyframes.map((k) =>
      k.frame >= duration / 2
        ? { frame: duration - k.frame, fromEnd: true, value: copy(k.value), easing: copy(k.easing) }
        : { frame: k.frame, value: copy(k.value), easing: copy(k.easing) }
    )
  }
  return stored
}

function restoreAnimatable<T extends AnimValue>(stored: LookAnimatable<T>, duration: number): Animatable<T> {
  const anim: Animatable<T> = { value: copy(stored.value) }
  if (!stored.keyframes?.length) return anim
  const byFrame = new Map<number, NonNullable<Animatable<T>['keyframes']>[number]>()
  for (const k of stored.keyframes) {
    const frame = Math.max(0, Math.min(duration - 1, k.fromEnd ? duration - k.frame : k.frame))
    // On a clip too short for both, the later keyframe wins.
    byFrame.set(frame, { frame, value: copy(k.value), easing: copy(k.easing) })
  }
  anim.keyframes = [...byFrame.values()].sort((a, b) => a.frame - b.frame)
  return anim
}

/** The look of a text clip, ready to be saved. */
export function captureTextLook(clip: TextClip): TextLook {
  const { position, scale, rotation, opacity, anchor } = clip.transform
  return {
    style: copy(clip.style),
    boxWidth: clip.boxWidth,
    ...(clip.reveal ? { reveal: copy(clip.reveal) } : {}),
    transform: {
      position: storeAnimatable(position, clip.duration),
      scale: storeAnimatable(scale, clip.duration),
      rotation: storeAnimatable(rotation, clip.duration),
      opacity: storeAnimatable(opacity, clip.duration),
      anchor: [anchor[0], anchor[1]]
    },
    blendMode: clip.blendMode,
    effects: clip.effects.map(({ type, enabled, params, resource }) => ({
      type,
      enabled,
      params: copy(params),
      ...(resource ? { resource } : {})
    }))
  }
}

/** Gives a text clip a saved look, keeping its words and timing. Animations fit the clip's length. */
export function applyTextLook(clip: TextClip, look: TextLook): void {
  const d = clip.duration
  clip.style = copy(look.style)
  clip.boxWidth = look.boxWidth
  if (look.reveal) clip.reveal = copy(look.reveal)
  else delete clip.reveal
  const transform: Transform = {
    position: restoreAnimatable(look.transform.position, d),
    scale: restoreAnimatable(look.transform.scale, d),
    rotation: restoreAnimatable(look.transform.rotation, d),
    opacity: restoreAnimatable(look.transform.opacity, d),
    anchor: [look.transform.anchor[0], look.transform.anchor[1]]
  }
  clip.transform = transform
  clip.blendMode = look.blendMode
  clip.effects = look.effects.map((e) => ({ ...copy(e), id: newId() }))
}

/** A new text clip in a saved look. */
export function createStyledTextClip(start: number, fps: number, text: string, look: TextLook): TextClip {
  const clip = createTextClip(start, fps, text)
  applyTextLook(clip, look)
  return clip
}
