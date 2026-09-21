import { create } from 'zustand'
import type { Draft } from 'immer'
import { createProject, History } from '@core/index'
import type { Clip, Id, Project } from '@core/index'

export type Tool = 'select' | 'razor'

export interface EditorState {
  project: Project
  /** Where the project is saved, or null if it never was. */
  path: string | null
  /** Bumped on every change; compared against `savedRevision` for the dirty flag. */
  revision: number
  savedRevision: number
  canUndo: boolean
  canRedo: boolean

  selection: Id[]
  /** A selected transition (exclusive with the clip selection). */
  selectedTransition: Id | null
  playhead: number
  playing: boolean
  tool: Tool
  snapping: boolean
  ripple: boolean
  /** Timeline zoom in pixels per frame. */
  zoom: number
  clipboard: Array<{ clip: Clip; trackId: Id }>
  missingMedia: Id[]
}

const history = new History<Project>()

export const useEditor = create<EditorState>(() => ({
  project: createProject(),
  path: null,
  revision: 0,
  savedRevision: 0,
  canUndo: false,
  canRedo: false,
  selection: [],
  selectedTransition: null,
  playhead: 0,
  playing: false,
  tool: 'select',
  snapping: true,
  ripple: false,
  zoom: 2,
  clipboard: [],
  missingMedia: []
}))

const get = useEditor.getState
const set = useEditor.setState

function commitProject(project: Project): void {
  const state = get()
  if (project === state.project) return
  const valid = new Set(project.tracks.flatMap((t) => t.clips.map((c) => c.id)))
  set({
    project,
    revision: state.revision + 1,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    selection: state.selection.filter((id) => valid.has(id))
  })
}

/** The one way to change the project: undoable, and a no-op recipe records nothing. */
export function edit(label: string, recipe: (draft: Draft<Project>) => void): void {
  commitProject(history.apply(get().project, label, recipe))
}

/** Groups the edits of a drag into a single undo step. */
export const beginTransaction = (label: string): void => history.begin(label)
export function commitTransaction(): void {
  history.commit()
  set({ canUndo: history.canUndo, canRedo: history.canRedo })
}
export const rollbackTransaction = (): void => commitProject(history.rollback(get().project))

export const undo = (): void => commitProject(history.undo(get().project))
export const redo = (): void => commitProject(history.redo(get().project))
export const undoLabel = (): string | undefined => history.undoLabel
export const redoLabel = (): string | undefined => history.redoLabel

/** Replaces the whole document (new/open); clears undo history and transient state. */
export function loadProject(project: Project, path: string | null, dirty = false): void {
  history.clear()
  const revision = get().revision + 1
  set({
    project,
    path,
    revision,
    savedRevision: dirty ? -1 : revision,
    canUndo: false,
    canRedo: false,
    selection: [],
    playhead: 0,
    playing: false,
    missingMedia: []
  })
}

export const markSaved = (path: string): void => set({ path, savedRevision: get().revision })
export const isDirty = (state: EditorState = get()): boolean => state.revision !== state.savedRevision

export function select(ids: Id[], additive = false): void {
  const current = get().selection
  if (!additive) return set({ selection: ids, selectedTransition: null })
  const next = new Set(current)
  for (const id of ids) {
    if (next.has(id)) next.delete(id)
    else next.add(id)
  }
  set({ selection: [...next], selectedTransition: null })
}

export function setPlayhead(frame: number): void {
  set({ playhead: Math.max(0, Math.round(frame)) })
}

export const MIN_ZOOM = 0.02
export const MAX_ZOOM = 40
export const setZoom = (zoom: number): void => set({ zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom)) })

export const selectTransition = (id: Id | null): void => set({ selectedTransition: id, selection: [] })
