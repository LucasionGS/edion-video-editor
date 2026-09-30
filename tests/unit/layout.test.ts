import { describe, expect, it } from 'vitest'
import {
  alignedPosition,
  boundsAroundAnchor,
  frameScale,
  snapToFrame,
  fillCell,
  layoutCells
} from '@core/index'
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

describe('snap to frame', () => {
  it('snaps an edge to the frame edge and reports the guide line', () => {
    // Half-size layer: its left edge sits 480 px left of the anchor. Frame left edge is at x = -960.
    const result = snapToFrame(half, [-476, 0], canvas, 8)
    expect(result.position).toEqual([-480, 0])
    expect(result.guidesX).toEqual([0])
    expect(result.guidesY).toEqual([540])
  })
  it('snaps the centre to the centre line and a corner to the corner', () => {
    expect(snapToFrame(half, [5, -6], canvas, 8).position).toEqual([0, 0])
    expect(snapToFrame(half, [475, 266], canvas, 8).position).toEqual([480, 270])
  })
  it('leaves the position alone outside the threshold', () => {
    const r = snapToFrame(half, [100, 100], canvas, 8)
    expect(r.position).toEqual([100, 100])
    expect(r.guidesX).toEqual([])
  })
  it('honours anchor and rotation through the visible box', () => {
    const lowerThird: Placement = { size: [400, 100], scale: [1, 1], rotation: 0, anchor: [0, 1] }
    expect(snapToFrame(lowerThird, [-955, 536], canvas, 8).position).toEqual([-960, 540])
  })
})

describe('split-screen layouts', () => {
  const canvas = { width: 1920, height: 1080 }
  it('splits the frame into cells', () => {
    expect(layoutCells('sideBySide', canvas)).toEqual([
      { x: 0, y: 0, width: 960, height: 1080 },
      { x: 960, y: 0, width: 960, height: 1080 }
    ])
    expect(layoutCells('grid', canvas, 10)[3]).toEqual({ x: 965, y: 545, width: 955, height: 535 })
    expect(layoutCells('pictureInPicture', canvas)[1]!.x + 576).toBeCloseTo(1920 - 43)
  })

  it('fills a cell by scaling to cover and cropping the overflow', () => {
    // A 16:9 layer in a half-width (8:9) cell: scaled to the cell height, cropped left and right.
    const { scale, crop, position } = fillCell(
      [1920, 1080],
      { x: 960, y: 0, width: 960, height: 1080 },
      canvas
    )
    expect(scale).toBe(1)
    expect(crop.left).toBeCloseTo(0.25)
    expect(crop.right).toBeCloseTo(0.25)
    expect(crop.top).toBe(0)
    expect(position).toEqual([480, 0])
  })
})
