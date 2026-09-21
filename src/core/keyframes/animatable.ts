import type { Animatable, AnimValue, Easing, Keyframe } from '../model/types'
import { applyEasing } from './easing'

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

function mix<T extends AnimValue>(a: T, b: T, t: number): T {
  if (typeof a === 'number') return lerp(a, b as number, t) as T
  const bv = b as [number, number]
  return [lerp(a[0], bv[0], t), lerp(a[1], bv[1], t)] as T
}

export const isAnimated = (a: Animatable<AnimValue>): boolean => (a.keyframes?.length ?? 0) > 0

/** Value at `frame` (relative to the clip start). The easing of a keyframe shapes the segment that follows it. */
export function evaluate<T extends AnimValue>(anim: Animatable<T>, frame: number): T {
  const kfs = anim.keyframes
  if (!kfs || kfs.length === 0) return anim.value
  const first = kfs[0]!
  const last = kfs[kfs.length - 1]!
  if (frame <= first.frame) return first.value
  if (frame >= last.frame) return last.value
  let lo = 0
  let hi = kfs.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (kfs[mid]!.frame <= frame) lo = mid
    else hi = mid
  }
  const a = kfs[lo]!
  const b = kfs[hi]!
  const t = (frame - a.frame) / (b.frame - a.frame)
  return mix(a.value, b.value, applyEasing(a.easing, t))
}

export const keyframeAt = <T>(anim: Animatable<T>, frame: number): Keyframe<T> | undefined =>
  anim.keyframes?.find((k) => k.frame === frame)

/** Writes a value: updates/creates a keyframe when animated, otherwise the static value. Mutates (Immer draft). */
export function setValueAt<T extends AnimValue>(anim: Animatable<T>, frame: number, value: T): void {
  if (!isAnimated(anim)) {
    anim.value = value
    return
  }
  upsertKeyframe(anim, frame, value)
}

export function upsertKeyframe<T extends AnimValue>(
  anim: Animatable<T>,
  frame: number,
  value: T = evaluate(anim, frame),
  easing: Easing = 'easeInOut'
): void {
  const kfs = (anim.keyframes ??= [])
  const existing = kfs.find((k) => k.frame === frame)
  if (existing) {
    existing.value = value
    return
  }
  kfs.push({ frame, value, easing })
  kfs.sort((a, b) => a.frame - b.frame)
}

export function removeKeyframe<T extends AnimValue>(anim: Animatable<T>, frame: number): void {
  if (!anim.keyframes) return
  const current = evaluate(anim, frame)
  anim.keyframes = anim.keyframes.filter((k) => k.frame !== frame)
  if (anim.keyframes.length === 0) {
    // Dropping the last keyframe keeps what the user currently sees.
    anim.value = current
    delete anim.keyframes
  }
}

export function moveKeyframe<T extends AnimValue>(anim: Animatable<T>, from: number, to: number): void {
  const kf = keyframeAt(anim, from)
  if (!kf || from === to || !anim.keyframes) return
  anim.keyframes = anim.keyframes.filter((k) => k === kf || k.frame !== to)
  kf.frame = to
  anim.keyframes.sort((a, b) => a.frame - b.frame)
}

/** Shifts all keyframes, e.g. when the clip's start edge is trimmed. */
export function shiftKeyframes(anim: Animatable<AnimValue>, delta: number): void {
  for (const k of anim.keyframes ?? []) k.frame += delta
}

/**
 * Splits an animation at `frame`: `anim` keeps the part before (mutated), the returned copy holds the part after,
 * re-based so that `frame` becomes 0. Both sides get a keyframe at the cut so the motion is unchanged.
 */
export function splitAnimatable<T extends AnimValue>(anim: Animatable<T>, frame: number): Animatable<T> {
  // JSON round trip: works on Immer drafts, and the data is plain by schema.
  const right = JSON.parse(JSON.stringify({ value: anim.value, keyframes: anim.keyframes })) as Animatable<T>
  if (!isAnimated(anim)) {
    delete right.keyframes
    return right
  }
  const kfs = anim.keyframes!
  const spans = kfs[0]!.frame < frame && kfs[kfs.length - 1]!.frame > frame
  if (spans) {
    const at = evaluate(anim, frame)
    const before = [...kfs].reverse().find((k) => k.frame < frame)!
    upsertKeyframe(anim, frame, at, before.easing)
    upsertKeyframe(right, frame, at, before.easing)
  }
  anim.keyframes = anim.keyframes!.filter((k) => k.frame <= frame)
  right.keyframes = right
    .keyframes!.filter((k) => k.frame >= frame)
    .map((k) => ({ ...k, frame: k.frame - frame }))
  // A side left with no keyframes holds the boundary value as a constant.
  if (anim.keyframes.length === 0) {
    anim.value = right.keyframes[0]!.value
    delete anim.keyframes
  }
  if (right.keyframes.length === 0) {
    right.value = kfs[kfs.length - 1]!.value
    delete right.keyframes
  }
  return right
}
