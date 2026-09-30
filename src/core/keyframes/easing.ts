import type { Easing } from '../model/types'

/** Solves a CSS-style cubic bezier (P0 = 0,0 and P3 = 1,1) for y at x. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number, x: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const sample = (a: number, b: number, t: number): number =>
    ((1 - 3 * b + 3 * a) * t + (3 * b - 6 * a)) * t * t + 3 * a * t
  const slope = (a: number, b: number, t: number): number =>
    3 * (1 - 3 * b + 3 * a) * t * t + 2 * (3 * b - 6 * a) * t + 3 * a
  let t = x
  for (let i = 0; i < 8; i++) {
    const error = sample(x1, x2, t) - x
    const d = slope(x1, x2, t)
    if (Math.abs(error) < 1e-6 || Math.abs(d) < 1e-6) break
    t -= error / d
  }
  // Newton can escape [0,1] on steep curves; fall back to bisection.
  if (t < 0 || t > 1 || Math.abs(sample(x1, x2, t) - x) > 1e-4) {
    let lo = 0
    let hi = 1
    for (let i = 0; i < 32; i++) {
      t = (lo + hi) / 2
      if (sample(x1, x2, t) < x) lo = t
      else hi = t
    }
  }
  return sample(y1, y2, t)
}

const PRESETS = {
  easeIn: [0.42, 0, 1, 1],
  easeOut: [0, 0, 0.58, 1],
  easeInOut: [0.42, 0, 0.58, 1]
} as const

/** Maps linear progress 0..1 to eased progress. */
export function applyEasing(easing: Easing, t: number): number {
  if (easing === 'linear') return t
  if (easing === 'hold') return t >= 1 ? 1 : 0
  const [x1, y1, x2, y2] = typeof easing === 'string' ? PRESETS[easing] : easing.bezier
  return cubicBezier(x1, y1, x2, y2, t)
}

/** An easing as cubic-bezier control points (linear is a straight bezier); null for 'hold', which jumps. */
export function easingBezier(easing: Easing): [number, number, number, number] | null {
  if (easing === 'hold') return null
  if (easing === 'linear') return [0, 0, 1, 1]
  const points = typeof easing === 'string' ? PRESETS[easing] : easing.bezier
  return [points[0], points[1], points[2], points[3]]
}
