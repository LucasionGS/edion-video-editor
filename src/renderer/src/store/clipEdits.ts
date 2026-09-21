import type { Draft } from 'immer'
import { findClip } from '@core/index'
import type { Clip, Id, Project } from '@core/index'
import { edit, useEditor } from './editor'

/** Applies `change` to each listed clip (skipping locked tracks) as one undoable edit. */
export function editClips(
  ids: readonly Id[],
  label: string,
  change: (clip: Draft<Clip>, project: Draft<Project>) => void
): void {
  edit(label, (draft) => {
    for (const id of ids) {
      const found = findClip(draft, id)
      if (found && !found.track.locked) change(found.clip, draft)
    }
  })
}

/** Playhead position relative to a clip, clamped into the clip. */
export function localFrame(clip: Pick<Clip, 'start' | 'duration'>): number {
  const { playhead } = useEditor.getState()
  return Math.max(0, Math.min(clip.duration - 1, playhead - clip.start))
}
