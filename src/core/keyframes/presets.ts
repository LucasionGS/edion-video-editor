import { applyEasing } from './easing'
import type { VisualClip } from '../model/types'

/**
 * Entrance and exit animations. They are stored on the clip (preset + length) rather than written as
 * keyframes, and applied when the scene is evaluated, measured from the clip's current start and end:
 * trimming, splitting or retiming a clip keeps them at its edges, and removing one always works. They
 * act on top of the clip's own transform and keyframes.
 */

export type AnimationPreset =
  'none' | 'fade' | 'slideUp' | 'slideDown' | 'slideLeft' | 'slideRight' | 'zoom' | 'pop'
export type ActivePreset = Exclude<AnimationPreset, 'none'>

export const ANIMATION_PRESETS: ReadonlyArray<{ value: AnimationPreset; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'fade', label: 'Fade' },
  { value: 'pop', label: 'Pop' },
  { value: 'zoom', label: 'Zoom' },
  { value: 'slideUp', label: 'Slide up' },
  { value: 'slideDown', label: 'Slide down' },
  { value: 'slideLeft', label: 'Slide left' },
  { value: 'slideRight', label: 'Slide right' }
]

/** Default length of a new entrance or exit, in seconds. */
export const DEFAULT_ANIMATION_SECONDS = 0.5

const SLIDE_DISTANCE = 0.12

/** Sets (or with 'none', removes) the entrance or exit of a clip. */
export function setClipAnimation(
  clip: VisualClip,
  edge: 'in' | 'out',
  preset: AnimationPreset,
  frames: number
): void {
  const animation = { ...clip.animation }
  if (preset === 'none') delete animation[edge]
  else animation[edge] = { preset, frames: Math.max(1, Math.round(frames)) }
  if (animation.in || animation.out) clip.animation = animation
  else delete clip.animation
}

/** What an entrance/exit does to a layer at one frame: added to position, multiplying scale and opacity. */
export interface AnimationEffect {
  dx: number
  dy: number
  scale: number
  opacity: number
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

/**
 * `t` runs from 0 (fully away) to 1 (at rest). Exits use the same curves with `t` counted back from the
 * end, so an exit is the exact reverse of the entrance.
 */
function shape(preset: ActivePreset, t: number, canvas: { width: number; height: number }): AnimationEffect {
  const e = applyEasing('easeOut', t)
  const away = 1 - e
  switch (preset) {
    case 'fade':
      return { dx: 0, dy: 0, scale: 1, opacity: e }
    case 'zoom':
      return { dx: 0, dy: 0, scale: lerp(0.6, 1, e), opacity: e }
    case 'pop': {
      // From almost nothing, swelling past full size, then settling; a quick fade only at the very start.
      const peak = 0.65
      const scale =
        t < peak
          ? lerp(0.02, 1.12, applyEasing('easeOut', t / peak))
          : lerp(1.12, 1, applyEasing('easeInOut', (t - peak) / (1 - peak)))
      return { dx: 0, dy: 0, scale, opacity: Math.min(1, t / 0.2) }
    }
    case 'slideUp':
      return { dx: 0, dy: away * SLIDE_DISTANCE * canvas.height, scale: 1, opacity: e }
    case 'slideDown':
      return { dx: 0, dy: -away * SLIDE_DISTANCE * canvas.height, scale: 1, opacity: e }
    case 'slideLeft':
      return { dx: away * SLIDE_DISTANCE * canvas.width, dy: 0, scale: 1, opacity: e }
    case 'slideRight':
      return { dx: -away * SLIDE_DISTANCE * canvas.width, dy: 0, scale: 1, opacity: e }
  }
}

const REST: AnimationEffect = { dx: 0, dy: 0, scale: 1, opacity: 1 }

/**
 * The combined effect of a clip's entrance and exit at a clip-relative frame. Each takes at most half the
 * clip, so both fit however short it gets.
 */
export function animationAt(
  clip: Pick<VisualClip, 'animation' | 'duration'>,
  localFrame: number,
  canvas: { width: number; height: number }
): AnimationEffect {
  const { animation, duration } = clip
  if (!animation) return REST
  const half = Math.max(1, Math.floor(duration / 2))
  let effect = REST
  const combine = (next: AnimationEffect): void => {
    effect = {
      dx: effect.dx + next.dx,
      dy: effect.dy + next.dy,
      scale: effect.scale * next.scale,
      opacity: effect.opacity * next.opacity
    }
  }
  if (animation.in) {
    const frames = Math.min(animation.in.frames, half)
    if (localFrame < frames) combine(shape(animation.in.preset, Math.max(0, localFrame / frames), canvas))
  }
  if (animation.out) {
    const frames = Math.min(animation.out.frames, half)
    // Counted so the last frame mirrors the first frame of an entrance (fully away).
    const remaining = duration - 1 - localFrame
    if (remaining < frames) combine(shape(animation.out.preset, Math.max(0, remaining / frames), canvas))
  }
  return effect
}
