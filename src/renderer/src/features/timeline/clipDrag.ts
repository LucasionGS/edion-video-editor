import type { PointerEvent as ReactPointerEvent } from 'react'
import {
  clipEnd,
  findClip,
  moveClips,
  nearestFreeStart,
  snap,
  snapPoints,
  snapThreshold,
  splitClip,
  trimClip
} from '@core/index'
import type { ClipMove, Id } from '@core/index'
import {
  beginTransaction,
  commitTransaction,
  edit,
  rollbackTransaction,
  select,
  useEditor
} from '@/store/editor'
import { startDrag } from './drag'
import { useTimelineView } from './view'

const state = useEditor.getState

function snapDelta(edges: number[], ignore: ReadonlySet<Id>, bypass: boolean): number {
  const { project, playhead, snapping, snap: settings, zoom } = state()
  if (!snapping || bypass) {
    useTimelineView.setState({ snapGuide: null })
    return 0
  }
  const { fps } = project.settings
  const hit = snap(
    edges,
    snapPoints(project, playhead, ignore, settings),
    snapThreshold(settings, zoom, fps),
    settings.gridSeconds * fps
  )
  useTimelineView.setState({ snapGuide: hit?.point ?? null })
  return hit?.delta ?? 0
}

/** Index of the track lane under a screen Y coordinate, or -1. */
function laneIndexAt(clientY: number): number {
  const lanes = [...document.querySelectorAll<HTMLElement>('[data-track-lane]')]
  return lanes.findIndex((lane) => {
    const rect = lane.getBoundingClientRect()
    return clientY >= rect.top && clientY < rect.bottom
  })
}

function tryMove(moves: ClipMove[]): boolean {
  let ok = false
  edit('Move clips', (draft) => void (ok = moveClips(draft, moves)))
  return ok
}

/** Click selects; dragging moves the whole selection with snapping, across tracks of the same kind. */
export function beginClipMove(event: ReactPointerEvent, clipId: Id): void {
  const additive = event.shiftKey || event.ctrlKey || event.metaKey
  const wasSelected = state().selection.includes(clipId)
  if (!wasSelected) select([clipId], additive)

  const origin = new Map<Id, { start: number; duration: number; trackIndex: number }>()
  let anchorTrackIndex = 0

  startDrag(event, {
    onStart() {
      const { project, selection } = state()
      for (const id of selection) {
        const found = findClip(project, id)
        if (!found || found.track.locked) continue
        origin.set(id, {
          start: found.clip.start,
          duration: found.clip.duration,
          trackIndex: project.tracks.indexOf(found.track)
        })
      }
      anchorTrackIndex = origin.get(clipId)?.trackIndex ?? 0
      beginTransaction('Move clips')
    },
    onMove(dx, _dy, e) {
      if (origin.size === 0) return
      const { project, zoom } = state()
      const ids = new Set(origin.keys())
      const entries = [...origin.entries()]
      let delta = Math.round(dx / zoom)
      delta += snapDelta(
        entries.flatMap(([, o]) => [o.start + delta, o.start + o.duration + delta]),
        ids,
        e.altKey
      )
      delta = Math.max(delta, -Math.min(...entries.map(([, o]) => o.start)))

      const lane = laneIndexAt(e.clientY)
      const trackDelta = lane < 0 ? 0 : lane - anchorTrackIndex
      const movesFor = (shift: number, by: number): ClipMove[] | null => {
        const moves: ClipMove[] = []
        for (const [id, o] of entries) {
          const track = project.tracks[o.trackIndex + shift]
          if (!track) return null
          moves.push({ clipId: id, trackId: track.id, start: o.start + by })
        }
        return moves
      }
      const attempt = (shift: number): boolean => {
        const moves = movesFor(shift, delta)
        if (moves && tryMove(moves)) return true
        // A single clip slides into the nearest gap instead of refusing to move.
        if (!moves || entries.length !== 1) return false
        const [id, o] = entries[0]!
        const track = project.tracks[o.trackIndex + shift]!
        return tryMove([
          { clipId: id, trackId: track.id, start: nearestFreeStart(track, o.start + delta, o.duration, ids) }
        ])
      }
      if (!attempt(trackDelta) && trackDelta !== 0) attempt(0)
    },
    onEnd(moved, cancelled) {
      useTimelineView.setState({ snapGuide: null })
      if (!moved) {
        // A plain click on an already selected clip narrows (or toggles) the selection.
        if (wasSelected) select([clipId], additive)
        return
      }
      if (cancelled) rollbackTransaction()
      else commitTransaction()
    }
  })
}

export function beginClipTrim(event: ReactPointerEvent, clipId: Id, edge: 'start' | 'end'): void {
  event.stopPropagation()
  select([clipId])
  const found = findClip(state().project, clipId)
  if (!found) return
  const originFrame = edge === 'start' ? found.clip.start : clipEnd(found.clip)
  startDrag(event, {
    onStart: () => beginTransaction('Trim clip'),
    onMove(dx, _dy, e) {
      let frame = originFrame + Math.round(dx / state().zoom)
      frame += snapDelta([frame], new Set([clipId]), e.altKey)
      edit('Trim clip', (draft) => void trimClip(draft, clipId, edge, frame))
    },
    onEnd(moved, cancelled) {
      useTimelineView.setState({ snapGuide: null })
      if (!moved) return
      if (cancelled) rollbackTransaction()
      else commitTransaction()
    }
  })
}

export function razorAt(clipId: Id, frame: number): void {
  edit('Split clip', (draft) => void splitClip(draft, clipId, frame))
}
