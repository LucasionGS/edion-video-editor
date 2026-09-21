import type { Crop, Vec2 } from '../model/types'

/** Layout helpers behind "fit", "fill" and the align/corner commands. Pure geometry, in project pixels. */

export type HorizontalAlign = 'left' | 'center' | 'right'
export type VerticalAlign = 'top' | 'center' | 'bottom'

export interface Placement {
  /** Size the layer draws at scale 1. */
  size: Vec2
  scale: Vec2
  /** Degrees, clockwise. */
  rotation: number
  anchor: Vec2
  crop?: Crop
}

export interface Canvas {
  width: number
  height: number
}

/** Uniform scale that makes the (cropped) layer fit inside the frame, or cover it completely. */
export function frameScale(size: Vec2, canvas: Canvas, mode: 'fit' | 'fill', crop?: Crop): number {
  const w = size[0] * (1 - (crop?.left ?? 0) - (crop?.right ?? 0))
  const h = size[1] * (1 - (crop?.top ?? 0) - (crop?.bottom ?? 0))
  if (w <= 0 || h <= 0) return 1
  const sx = canvas.width / w
  const sy = canvas.height / h
  return mode === 'fit' ? Math.min(sx, sy) : Math.max(sx, sy)
}

/** Bounding box of the visible (cropped, scaled, rotated) layer, relative to its anchor point. */
export function boundsAroundAnchor({ size, scale, rotation, anchor, crop }: Placement): {
  minX: number
  maxX: number
  minY: number
  maxY: number
} {
  const left = (crop?.left ?? 0) - anchor[0]
  const right = 1 - (crop?.right ?? 0) - anchor[0]
  const top = (crop?.top ?? 0) - anchor[1]
  const bottom = 1 - (crop?.bottom ?? 0) - anchor[1]
  const rad = (rotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const xs: number[] = []
  const ys: number[] = []
  for (const [u, v] of [
    [left, top],
    [right, top],
    [left, bottom],
    [right, bottom]
  ] as const) {
    const x = u * size[0] * scale[0]
    const y = v * size[1] * scale[1]
    xs.push(x * cos - y * sin)
    ys.push(x * sin + y * cos)
  }
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
}

/**
 * Position (anchor offset from the frame centre) that aligns the layer's visible bounding box with the
 * frame. `null` on an axis keeps the current coordinate. `margin` insets the left/right/top/bottom edges.
 */
export function alignedPosition(
  placement: Placement,
  current: Vec2,
  canvas: Canvas,
  horizontal: HorizontalAlign | null,
  vertical: VerticalAlign | null,
  margin = 0
): Vec2 {
  const b = boundsAroundAnchor(placement)
  let [x, y] = current
  if (horizontal === 'left') x = -canvas.width / 2 + margin - b.minX
  else if (horizontal === 'right') x = canvas.width / 2 - margin - b.maxX
  else if (horizontal === 'center') x = -(b.minX + b.maxX) / 2
  if (vertical === 'top') y = -canvas.height / 2 + margin - b.minY
  else if (vertical === 'bottom') y = canvas.height / 2 - margin - b.maxY
  else if (vertical === 'center') y = -(b.minY + b.maxY) / 2
  // `+ 0` turns -0 into 0 so centred values read and serialise cleanly.
  return [x + 0, y + 0]
}

export interface EdgeSnap {
  position: Vec2
  /** Frame-space lines (x = ... / y = ...) that were snapped to, for drawing guides. */
  guidesX: number[]
  guidesY: number[]
}

/**
 * Snaps a layer being dragged so that its visible box's left/centre/right (and top/centre/bottom)
 * align with the frame's edges and centre lines when within `threshold` project pixels.
 * Guide coordinates are in frame space (origin top-left).
 */
export function snapToFrame(
  placement: Placement,
  position: Vec2,
  canvas: Canvas,
  threshold: number
): EdgeSnap {
  const b = boundsAroundAnchor(placement)
  const solve = (
    coordinate: number,
    min: number,
    max: number,
    size: number
  ): { value: number; guide: number | null } => {
    const half = size / 2
    // Feature offsets from the anchor: leading edge, centre, trailing edge.
    const features = [min, (min + max) / 2, max]
    const lines = [-half, 0, half]
    let best: { value: number; guide: number; distance: number } | null = null
    for (const feature of features) {
      for (const line of lines) {
        const value = line - feature
        const distance = Math.abs(value - coordinate)
        if (distance <= threshold && (!best || distance < best.distance))
          best = { value, guide: line + half, distance }
      }
    }
    return best ? { value: best.value + 0, guide: best.guide } : { value: coordinate, guide: null }
  }
  const sx = solve(position[0], b.minX, b.maxX, canvas.width)
  const sy = solve(position[1], b.minY, b.maxY, canvas.height)
  return {
    position: [sx.value, sy.value],
    guidesX: sx.guide === null ? [] : [sx.guide],
    guidesY: sy.guide === null ? [] : [sy.guide]
  }
}
