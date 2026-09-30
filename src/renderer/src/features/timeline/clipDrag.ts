import type { PointerEvent as ReactPointerEvent } from 'react'
import {
  clipEnd,
  findClip,
  moveClips,
  nearestFreeStart,
  rippleTrim,
  rollEdit,
  snap,
  snapPoints,
  slideClip,
  slipClip,
  snapThreshold,
  splitClip,
  trimClip,
  trimLinked,
  withLinked
} from '@core/index'
import type { ClipMove, Id } from '@core/index'
import {
  beginTransaction,
  commitTransaction,
  edit,
  editTargets,
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

  // Alt at press time moves only the selected clips, leaving linked partners behind.
  const soloLinked = event.altKey
  const origin = new Map<Id, { start: number; duration: number; trackIndex: number; followsLane: boolean }>()
  let anchorTrackIndex = 0

  startDrag(event, {
    onStart() {
      const { project, selection } = state()
      const anchorKind = findClip(project, clipId)?.track.kind
      for (const id of soloLinked ? selection : editTargets(selection)) {
        const found = findClip(project, id)
        if (!found || found.track.locked) continue
        origin.set(id, {
          start: found.clip.start,
          duration: found.clip.duration,
          trackIndex: project.tracks.indexOf(found.track),
          // Only clips on the same kind of track as the grabbed one change lanes with the pointer.
          followsLane: found.track.kind === anchorKind
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
          const track = project.tracks[o.trackIndex + (o.followsLane ? shift : 0)]
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

/**
 * Drags a clip edge. What that does depends on the tool: a plain trim (select tool), a ripple trim that
 * moves later clips along (ripple tool), or a roll of the cut shared with the neighbouring clip (roll tool).
 */
export function beginClipTrim(event: ReactPointerEvent, clipId: Id, edge: 'start' | 'end'): void {
  event.stopPropagation()
  select([clipId])
  const { project, tool } = state()
  const found = findClip(project, clipId)
  if (!found) return
  const originFrame = edge === 'start' ? found.clip.start : clipEnd(found.clip)
  // Alt at press time trims just this clip (for split edits); otherwise lined-up linked clips follow.
  const linked = state().linkedSelection && !event.altKey
  const group = linked ? withLinked(project, [clipId]) : [clipId]

  // Rolling a start edge rolls the cut with the clip that ends there.
  const previous = found.track.clips[found.index - 1]
  const rollLeft =
    tool !== 'roll'
      ? null
      : edge === 'end'
        ? found.track.clips[found.index + 1]?.start === originFrame
          ? clipId
          : null
        : previous && clipEnd(previous) === originFrame
          ? previous.id
          : null
  const mode = rollLeft ? 'roll' : tool === 'ripple' ? 'ripple' : 'trim'
  const label = mode === 'roll' ? 'Roll edit' : mode === 'ripple' ? 'Ripple trim' : 'Trim clip'

  // Clips that move during the drag are no snap targets.
  const ignore = new Set(group)
  if (mode === 'roll') for (const id of withLinked(project, [rollLeft!])) ignore.add(id)
  if (mode === 'ripple') {
    for (const id of group) {
      const located = findClip(project, id)
      for (const clip of located?.track.clips ?? []) if (clip.start >= originFrame) ignore.add(clip.id)
    }
  }

  startDrag(event, {
    onStart: () => beginTransaction(label),
    onMove(dx, _dy, e) {
      let frame = originFrame + Math.round(dx / state().zoom)
      frame += snapDelta([frame], ignore, e.altKey)
      edit(label, (draft) => {
        if (mode === 'roll') rollEdit(draft, rollLeft!, frame, linked)
        else if (mode === 'ripple') rippleTrim(draft, clipId, edge, frame, linked)
        else if (linked) trimLinked(draft, clipId, edge, frame)
        else trimClip(draft, clipId, edge, frame)
      })
    },
    onEnd(moved, cancelled) {
      useTimelineView.setState({ snapGuide: null })
      if (!moved) return
      if (cancelled) rollbackTransaction()
      else commitTransaction()
    }
  })
}

/**
 * Slip (change the part of the source a clip shows) or slide (move a clip while its neighbours absorb
 * the change) by dragging the clip body. Slipping follows the pointer like dragging the footage itself.
 */
export function beginSlipOrSlide(event: ReactPointerEvent, clipId: Id, mode: 'slip' | 'slide'): void {
  event.stopPropagation()
  select([clipId])
  const found = findClip(state().project, clipId)
  if (!found) return
  const linked = state().linkedSelection && !event.altKey
  const { start, duration } = found.clip
  const ignore = new Set(withLinked(state().project, [clipId]))
  const label = mode === 'slip' ? 'Slip clip' : 'Slide clip'
  let applied = 0
  startDrag(event, {
    onStart: () => beginTransaction(label),
    onMove(dx, _dy, e) {
      let delta = Math.round(dx / state().zoom)
      if (mode === 'slide') delta += snapDelta([start + delta, start + duration + delta], ignore, e.altKey)
      const wanted = mode === 'slip' ? -delta : delta
      edit(label, (draft) => {
        const step = wanted - applied
        applied +=
          mode === 'slip' ? slipClip(draft, clipId, step, linked) : slideClip(draft, clipId, step, linked)
      })
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
  edit('Split clip', (draft) => void splitClip(draft, clipId, frame, state().linkedSelection))
}
