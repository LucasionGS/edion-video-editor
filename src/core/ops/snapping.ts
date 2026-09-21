import type { Id, Project } from '../model/types'
import { clipEnd } from './query'

/** Frames worth snapping to: clip edges, markers, the playhead, and the timeline start. */
export function snapPoints(
  project: Project,
  playhead: number,
  ignore: ReadonlySet<Id> = new Set()
): number[] {
  const points = new Set<number>([0, playhead])
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (ignore.has(clip.id)) continue
      points.add(clip.start)
      points.add(clipEnd(clip))
    }
  }
  for (const marker of project.markers) points.add(marker.frame)
  return [...points].sort((a, b) => a - b)
}

export interface SnapResult {
  /** Offset to add to the dragged frames. */
  delta: number
  /** The frame snapped to, for drawing the guide. */
  point: number
}

/** Snaps any of `edges` (e.g. a clip's start and end) to the closest point within `threshold` frames. */
export function snap(
  edges: readonly number[],
  points: readonly number[],
  threshold: number
): SnapResult | null {
  let best: SnapResult | null = null
  for (const edge of edges) {
    for (const point of points) {
      const delta = point - edge
      if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta)))
        best = { delta, point }
    }
  }
  return best
}
