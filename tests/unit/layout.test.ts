import { describe, expect, it } from 'vitest'
import { alignedPosition, boundsAroundAnchor, frameScale } from '@core/index'
import type { Placement } from '@core/index'

const canvas = { width: 1920, height: 1080 }
const half: Placement = { size: [1920, 1080], scale: [0.5, 0.5], rotation: 0, anchor: [0.5, 0.5] }

describe('frame scale', () => {
  it('fits and fills', () => {
    expect(frameScale([1000, 1000], canvas, 'fit')).toBeCloseTo(1.08)
    expect(frameScale([1000, 1000], canvas, 'fill')).toBeCloseTo(1.92)
  })
  it('accounts for crop', () => {
    // A pillarboxed 4:3 picture inside a 16:9 source, cropped to the picture, fills by scaling up.
    expect(
      frameScale([1920, 1080], canvas, 'fit', { left: 0.125, right: 0.125, top: 0, bottom: 0 })
    ).toBeCloseTo(1)
    expect(
      frameScale([1920, 1080], canvas, 'fill', { left: 0.125, right: 0.125, top: 0, bottom: 0 })
    ).toBeCloseTo(4 / 3)
  })
})

describe('alignment', () => {
  it('puts a half-size layer into the corners', () => {
    expect(alignedPosition(half, [7, 7], canvas, 'left', 'top')).toEqual([-480, -270])
    expect(alignedPosition(half, [7, 7], canvas, 'right', 'bottom', 40)).toEqual([440, 230])
  })
  it('centres one axis and keeps the other', () => {
    expect(alignedPosition(half, [123, 45], canvas, 'center', null)).toEqual([0, 45])
    expect(alignedPosition(half, [123, 45], canvas, null, 'center')).toEqual([123, 0])
  })
  it('respects a non-central anchor', () => {
    const lowerThird: Placement = { size: [400, 100], scale: [1, 1], rotation: 0, anchor: [0, 1] }
    expect(alignedPosition(lowerThird, [0, 0], canvas, 'left', 'bottom')).toEqual([-960, 540])
    expect(alignedPosition(lowerThird, [0, 0], canvas, 'center', 'center')).toEqual([-200, 50])
  })
  it('uses the rotated bounding box', () => {
    const b = boundsAroundAnchor({ size: [200, 100], scale: [1, 1], rotation: 90, anchor: [0.5, 0.5] })
    expect(b.maxX - b.minX).toBeCloseTo(100)
    expect(b.maxY - b.minY).toBeCloseTo(200)
  })
  it('aligns the visible part of a cropped layer', () => {
    const cropped: Placement = { ...half, crop: { left: 0.5, top: 0, right: 0, bottom: 0 } }
    // Only the right half is visible (480 px wide); its left edge sits at the anchor.
    expect(alignedPosition(cropped, [0, 0], canvas, 'left', null)[0]).toBe(-960)
  })
  it('handles flipped layers', () => {
    const flipped: Placement = { ...half, scale: [-0.5, 0.5] }
    expect(alignedPosition(flipped, [0, 0], canvas, 'left', 'top')).toEqual([-480, -270])
  })
})
