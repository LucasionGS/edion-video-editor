import { describe, expect, it } from 'vitest'
import {
  applyEasing, cubicBezier, evaluate, moveKeyframe, removeKeyframe, setValueAt, splitAnimatable, upsertKeyframe
} from '@core/index'
import type { Animatable, Vec2 } from '@core/index'

describe('easing', () => {
  it('keeps endpoints fixed', () => {
    for (const e of ['linear', 'easeIn', 'easeOut', 'easeInOut'] as const) {
      expect(applyEasing(e, 0)).toBeCloseTo(0)
      expect(applyEasing(e, 1)).toBeCloseTo(1)
    }
  })
  it('is symmetric for easeInOut', () => expect(applyEasing('easeInOut', 0.5)).toBeCloseTo(0.5, 3))
  it('eases in slowly', () => expect(applyEasing('easeIn', 0.25)).toBeLessThan(0.25))
  it('holds until the end', () => {
    expect(applyEasing('hold', 0.99)).toBe(0)
    expect(applyEasing('hold', 1)).toBe(1)
  })
  it('matches a linear bezier', () => expect(cubicBezier(0.25, 0.25, 0.75, 0.75, 0.3)).toBeCloseTo(0.3, 4))
  it('survives steep curves', () => {
    const y = cubicBezier(0.9, 0, 0.1, 1, 0.5)
    expect(y).toBeGreaterThan(0.4)
    expect(y).toBeLessThan(0.6)
  })
})

describe('animatable', () => {
  const ramp = (): Animatable<number> => ({
    value: 0,
    keyframes: [
      { frame: 10, value: 0, easing: 'linear' },
      { frame: 20, value: 100, easing: 'linear' }
    ]
  })

  it('returns the static value without keyframes', () => expect(evaluate({ value: 7 }, 99)).toBe(7))
  it('clamps outside the keyframe range', () => {
    expect(evaluate(ramp(), 0)).toBe(0)
    expect(evaluate(ramp(), 50)).toBe(100)
  })
  it('interpolates numbers and vectors', () => {
    expect(evaluate(ramp(), 15)).toBeCloseTo(50)
    const v: Animatable<Vec2> = {
      value: [0, 0],
      keyframes: [
        { frame: 0, value: [0, 10], easing: 'linear' },
        { frame: 10, value: [100, 20], easing: 'linear' }
      ]
    }
    expect(evaluate(v, 5)).toEqual([50, 15])
  })
  it('writes the static value until animated, then keyframes', () => {
    const a: Animatable<number> = { value: 1 }
    setValueAt(a, 5, 2)
    expect(a).toEqual({ value: 2 })
    upsertKeyframe(a, 0)
    setValueAt(a, 5, 9)
    expect(a.keyframes?.map((k) => [k.frame, k.value])).toEqual([[0, 2], [5, 9]])
  })
  it('keeps the visible value when the last keyframe goes', () => {
    const a: Animatable<number> = { value: 0, keyframes: [{ frame: 3, value: 42, easing: 'linear' }] }
    removeKeyframe(a, 3)
    expect(a).toEqual({ value: 42 })
  })
  it('moves keyframes and replaces collisions', () => {
    const a = ramp()
    moveKeyframe(a, 10, 20)
    expect(a.keyframes).toHaveLength(1)
    expect(a.keyframes![0]).toMatchObject({ frame: 20, value: 0 })
  })
  it('splits without changing the motion', () => {
    const left = ramp()
    const right = splitAnimatable(left, 15)
    expect(evaluate(left, 12)).toBeCloseTo(20)
    expect(evaluate(left, 15)).toBeCloseTo(50)
    expect(evaluate(right, 0)).toBeCloseTo(50)
    expect(evaluate(right, 5)).toBeCloseTo(100)
  })
  it('splits outside the animated range into constants', () => {
    const left = ramp()
    const right = splitAnimatable(left, 30)
    expect(left.keyframes).toHaveLength(2)
    expect(right).toEqual({ value: 100 })
  })
})
