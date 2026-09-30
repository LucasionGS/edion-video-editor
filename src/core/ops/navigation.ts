import type { Id, Project } from '../model/types'
import { formatClock } from '../model/time'
import { clipEnd } from './query'

/** Jumping around the timeline, and markers. */

/** The nearest clip start or end strictly before (-1) or after (1) `frame`, on unhidden tracks. */
export function nextEditPoint(project: Project, frame: number, direction: 1 | -1): number | null {
  let best: number | null = null
  for (const track of project.tracks) {
    if (track.hidden) continue
    for (const clip of track.clips) {
      for (const edge of [clip.start, clipEnd(clip)]) {
        if (direction === 1 ? edge <= frame : edge >= frame) continue
        if (best === null || (direction === 1 ? edge < best : edge > best)) best = edge
      }
    }
  }
  return best
}

/** The nearest marker strictly before (-1) or after (1) `frame`. */
export function nextMarker(project: Project, frame: number, direction: 1 | -1): number | null {
  const frames = project.markers.map((m) => m.frame).filter((f) => (direction === 1 ? f > frame : f < frame))
  if (frames.length === 0) return null
  return direction === 1 ? Math.min(...frames) : Math.max(...frames)
}

/** Moves a marker; a marker already at the target is replaced. */
export function moveMarker(project: Project, markerId: Id, frame: number): void {
  const marker = project.markers.find((m) => m.id === markerId)
  if (!marker) return
  const target = Math.max(0, Math.round(frame))
  project.markers = project.markers.filter((m) => m === marker || m.frame !== target)
  marker.frame = target
  project.markers.sort((a, b) => a.frame - b.frame)
}

/**
 * Markers as YouTube chapters (`0:00 Intro`, one per line). YouTube wants the first chapter at 0:00,
 * so one is added when the first marker comes later. Unnamed markers are called "Chapter n".
 */
export function chapterList(project: Project): string {
  const { fps } = project.settings
  const markers = [...project.markers].sort((a, b) => a.frame - b.frame)
  const lines = markers.map((m, i) => `${formatClock(m.frame / fps)} ${m.label.trim() || `Chapter ${i + 1}`}`)
  if (markers.length > 0 && markers[0]!.frame >= fps) lines.unshift('0:00 Intro')
  return lines.join('\n')
}
