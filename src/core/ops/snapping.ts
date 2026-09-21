import type { Id, Project } from '../model/types'
import { clipEnd } from './query'

/** What dragged clips and trim handles may snap to, and how eagerly. */
export interface SnapSettings {
  /** Pull radius in screen pixels. */
  distance: number
  /**
   * Upper bound of the pull in seconds, or 0 for none. Zoomed far out, a few pixels are whole
   * seconds of timeline; the cap keeps snapping from dragging clips that far.
   */
  maxSeconds: number
  /** Spacing of an invisible time grid to snap to, in seconds; 0 turns the grid off. */
  gridSeconds: number
  clipEdges: boolean
  playhead: boolean
  markers: boolean
}

export const DEFAULT_SNAP_SETTINGS: SnapSettings = {
  distance: 8,
  maxSeconds: 0.25,
  gridSeconds: 0,
  clipEdges: true,
  playhead: true,
  markers: true
}

type SnapTargets = Pick<SnapSettings, 'clipEdges' | 'playhead' | 'markers'>

/** Frames worth snapping to: the timeline start plus the enabled targets. */
export function snapPoints(
  project: Project,
  playhead: number,
  ignore: ReadonlySet<Id> = new Set(),
  targets: SnapTargets = DEFAULT_SNAP_SETTINGS
): number[] {
  const points = new Set<number>([0])
  if (targets.playhead) points.add(playhead)
  if (targets.clipEdges) {
    for (const track of project.tracks) {
      for (const clip of track.clips) {
        if (ignore.has(clip.id)) continue
        points.add(clip.start)
        points.add(clipEnd(clip))
      }
    }
  }
  if (targets.markers) for (const marker of project.markers) points.add(marker.frame)
  return [...points].sort((a, b) => a - b)
}

/** Pull radius in frames at the given zoom (pixels per frame). Never below one frame, so exact neighbours always catch. */
export function snapThreshold(settings: SnapSettings, zoom: number, fps: number): number {
  const byPixels = settings.distance / zoom
  const cap = settings.maxSeconds > 0 ? settings.maxSeconds * fps : Infinity
  return Math.max(1, Math.min(byPixels, cap))
}

export interface SnapResult {
  /** Offset to add to the dragged frames. */
  delta: number
  /** The frame snapped to, for drawing the guide. */
  point: number
}

/**
 * Snaps any of `edges` (e.g. a clip's start and end) to the closest point within `threshold` frames.
 * With `gridFrames` > 0 the multiples of it count as points too; real targets win ties.
 */
export function snap(
  edges: readonly number[],
  points: readonly number[],
  threshold: number,
  gridFrames = 0
): SnapResult | null {
  let best: SnapResult | null = null
  const consider = (edge: number, point: number): void => {
    const delta = point - edge
    if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta)))
      best = { delta, point }
  }
  for (const edge of edges) for (const point of points) consider(edge, point)
  if (gridFrames > 0) {
    for (const edge of edges) consider(edge, Math.round(Math.round(edge / gridFrames) * gridFrames))
  }
  return best
}
