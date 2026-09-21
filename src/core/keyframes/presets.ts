import { evaluate } from './animatable'
import type { Animatable, AnimValue, Easing, Vec2, VisualClip } from '../model/types'

export type AnimationPreset =
  'none' | 'fade' | 'slideUp' | 'slideDown' | 'slideLeft' | 'slideRight' | 'zoom' | 'pop'

export const ANIMATION_PRESETS: ReadonlyArray<{ value: AnimationPreset; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'fade', label: 'Fade' },
  { value: 'slideUp', label: 'Slide up' },
  { value: 'slideDown', label: 'Slide down' },
  { value: 'slideLeft', label: 'Slide left' },
  { value: 'slideRight', label: 'Slide right' },
  { value: 'zoom', label: 'Zoom' },
  { value: 'pop', label: 'Pop' }
]

const SLIDE_DISTANCE = 0.12

/** Replaces every keyframe inside [from, to] with a two-key ramp between `a` and `b`. */
function ramp<T extends AnimValue>(
  anim: Animatable<T>,
  from: number,
  to: number,
  a: T,
  b: T,
  easing: Easing
): void {
  const kept = (anim.keyframes ?? []).filter((k) => k.frame < from || k.frame > to)
  anim.keyframes = [
    ...kept,
    { frame: from, value: a, easing },
    { frame: to, value: b, easing: 'linear' as Easing }
  ].sort((x, y) => x.frame - y.frame)
}

/**
 * Writes an entrance (`edge: 'in'`) or exit animation as ordinary keyframes, so it can be tweaked
 * afterwards like any hand-made animation. 'none' removes keyframes in that part of the clip.
 */
export function applyAnimationPreset(
  clip: VisualClip,
  edge: 'in' | 'out',
  preset: AnimationPreset,
  frames: number,
  canvas: { width: number; height: number }
): void {
  const length = Math.max(1, Math.min(frames, Math.floor(clip.duration / 2)))
  const from = edge === 'in' ? 0 : clip.duration - 1 - length
  const to = from + length
  const { position, scale, opacity } = clip.transform
  // The resting values are whatever the clip shows right after/before the animated part.
  const restFrame = edge === 'in' ? to : from
  const rest = {
    position: evaluate(position, restFrame),
    scale: evaluate(scale, restFrame),
    opacity: evaluate(opacity, restFrame)
  }

  for (const anim of [position, scale, opacity] as Animatable<AnimValue>[]) {
    anim.keyframes = anim.keyframes?.filter((k) => k.frame < from || k.frame > to)
    if (anim.keyframes?.length === 0) delete anim.keyframes
  }
  position.value = rest.position
  scale.value = rest.scale
  opacity.value = rest.opacity
  if (preset === 'none') return

  const easing: Easing = edge === 'in' ? 'easeOut' : 'easeIn'
  const between = <T extends AnimValue>(anim: Animatable<T>, away: T, resting: T): void =>
    edge === 'in' ? ramp(anim, from, to, away, resting, easing) : ramp(anim, from, to, resting, away, easing)

  between(opacity, 0, rest.opacity || 1)
  const offset = (dx: number, dy: number): Vec2 => [
    rest.position[0] + dx * canvas.width,
    rest.position[1] + dy * canvas.height
  ]
  const scaled = (factor: number): Vec2 => [rest.scale[0] * factor, rest.scale[1] * factor]
  switch (preset) {
    case 'slideUp':
      between(position, offset(0, SLIDE_DISTANCE), rest.position)
      break
    case 'slideDown':
      between(position, offset(0, -SLIDE_DISTANCE), rest.position)
      break
    case 'slideLeft':
      between(position, offset(SLIDE_DISTANCE, 0), rest.position)
      break
    case 'slideRight':
      between(position, offset(-SLIDE_DISTANCE, 0), rest.position)
      break
    case 'zoom':
      between(scale, scaled(0.6), rest.scale)
      break
    case 'pop':
      if (edge === 'in') {
        scale.keyframes = [
          ...(scale.keyframes ?? []),
          { frame: from, value: scaled(0.3), easing: 'easeOut' as Easing },
          { frame: from + Math.round(length * 0.7), value: scaled(1.12), easing: 'easeInOut' as Easing },
          { frame: to, value: rest.scale, easing: 'linear' as Easing }
        ].sort((a, b) => a.frame - b.frame)
      } else between(scale, scaled(0.3), rest.scale)
      break
    case 'fade':
      break
  }
}
