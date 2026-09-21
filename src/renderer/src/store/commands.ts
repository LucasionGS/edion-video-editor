import { clipAtFrame, deleteClips, findClip, pasteClips, splitClip } from '@core/index'
import type { Id } from '@core/index'
import { edit, select, useEditor } from './editor'

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
  const { selection } = state()
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
