import {
  clipAtFrame,
  DEFAULT_TRANSITION_SECONDS,
  deleteClips,
  findClip,
  insertClipAuto,
  pasteClips,
  removeTransition,
  setTransition,
  splitClip
} from '@core/index'
import type { Clip, Id, ProjectSettings } from '@core/index'
import { edit, select, selectTransition, useEditor } from './editor'

/** User-level commands shared by buttons, menus and keyboard shortcuts. */

const state = useEditor.getState

/** Splits the selected clips under the playhead, or every unlocked clip under it when nothing is selected. */
export function splitAtPlayhead(): void {
  const { project, playhead, selection } = state()
  const targets: Id[] = selection.length
    ? selection
    : project.tracks.flatMap((t) => (t.locked ? [] : (clipAtFrame(t, playhead)?.id ?? [])))
  edit('Split clips', (draft) => {
    for (const id of targets) splitClip(draft, id, playhead)
  })
}

export function deleteSelection(ripple = state().ripple): void {
  const { selection, selectedTransition } = state()
  if (selectedTransition) {
    edit('Remove transition', (draft) => removeTransition(draft, selectedTransition))
    return selectTransition(null)
  }
  if (selection.length === 0) return
  edit(ripple ? 'Ripple delete' : 'Delete clips', (draft) => deleteClips(draft, selection, ripple))
}

export function copySelection(): void {
  const { project, selection } = state()
  const clipboard = selection.flatMap((id) => {
    const found = findClip(project, id)
    return found ? [{ clip: structuredClone(found.clip), trackId: found.track.id }] : []
  })
  if (clipboard.length > 0) useEditor.setState({ clipboard })
}

export function cutSelection(): void {
  copySelection()
  deleteSelection()
}

export function paste(): void {
  const { clipboard, playhead } = state()
  if (clipboard.length === 0) return
  let ids: Id[] = []
  edit('Paste', (draft) => void (ids = pasteClips(draft, clipboard, playhead)))
  select(ids)
}

export function duplicateSelection(): void {
  const { project, selection } = state()
  const clips = selection.flatMap((id) => {
    const found = findClip(project, id)
    return found ? [{ clip: found.clip, trackId: found.track.id }] : []
  })
  if (clips.length === 0) return
  const end = Math.max(...clips.map((c) => c.clip.start + c.clip.duration))
  let ids: Id[] = []
  edit('Duplicate', (draft) => void (ids = pasteClips(draft, clips, end)))
  select(ids)
}

export function selectAll(): void {
  select(state().project.tracks.flatMap((t) => (t.locked ? [] : t.clips.map((c) => c.id))))
}

/** Marks the export range: I sets the in point, O the out point (exclusive), at the playhead. */
export function setRangeEdge(edge: 'in' | 'out'): void {
  const { project, playhead } = state()
  const end = Math.max(1, ...project.tracks.flatMap((t) => t.clips.map((c) => c.start + c.duration)))
  edit(edge === 'in' ? 'Set in point' : 'Set out point', (draft) => {
    const range = draft.range ?? { in: 0, out: end }
    if (edge === 'in') range.in = Math.min(playhead, end - 1)
    else range.out = Math.max(1, playhead)
    if (range.out <= range.in) {
      if (edge === 'in') range.out = end
      else range.in = 0
    }
    draft.range = range
  })
}

export const clearRange = (): void => edit('Clear range', (draft) => void (draft.range = null))

export function addMarker(): void {
  const { playhead } = state()
  edit('Add marker', (draft) => {
    if (draft.markers.some((m) => m.frame === playhead))
      draft.markers = draft.markers.filter((m) => m.frame !== playhead)
    else
      draft.markers.push({
        id: crypto.randomUUID().slice(0, 12),
        frame: playhead,
        label: '',
        color: '#f5c451'
      })
  })
}

// ── Titles, shapes, transitions, captions ─────────────────────────────────────────────────────────

/** Adds a generated clip (text, shape, caption) at the playhead and selects it. */
export function addGeneratedClip(
  label: string,
  make: (start: number, settings: ProjectSettings) => Clip
): void {
  const { playhead } = state()
  let id: Id | null = null
  edit(label, (draft) => {
    const clip = make(playhead, draft.settings)
    insertClipAuto(draft, clip)
    id = clip.id
  })
  if (id) select([id])
}

/**
 * Puts a transition on a cut: the one after the selected clip if it touches another clip,
 * otherwise the one before it, otherwise the cut nearest to the playhead.
 */
export function applyTransition(type: string): boolean {
  const { project, selection, playhead } = state()
  const frames = Math.max(2, Math.round(DEFAULT_TRANSITION_SECONDS * project.settings.fps))
  const candidates: Array<{ leftId: Id; distance: number }> = []
  for (const track of project.tracks) {
    if (track.kind !== 'video' || track.locked) continue
    track.clips.forEach((clip, i) => {
      const next = track.clips[i + 1]
      if (!next || next.start !== clip.start + clip.duration) return
      const selected = selection.includes(clip.id) ? 0 : selection.includes(next.id) ? 1 : 2
      candidates.push({ leftId: clip.id, distance: selected * 1e9 + Math.abs(next.start - playhead) })
    })
  }
  const best = candidates.sort((a, b) => a.distance - b.distance)[0]
  if (!best) return false
  let id: Id | null = null
  edit('Add transition', (draft) => void (id = setTransition(draft, best.leftId, type, frames)))
  if (id) selectTransition(id)
  return id !== null
}
