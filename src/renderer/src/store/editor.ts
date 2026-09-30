import { create } from 'zustand'
import type { Draft } from 'immer'
import { createProject, DEFAULT_SNAP_SETTINGS, History, TIME_DISPLAYS, withLinked } from '@core/index'
import type { Clip, Id, Project, SnapSettings, TimeDisplay } from '@core/index'

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
  snap: SnapSettings
  timeDisplay: TimeDisplay
  ripple: boolean
  /** Selecting, moving, trimming or deleting a linked clip includes its partners. */
  linkedSelection: boolean
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
  snap: DEFAULT_SNAP_SETTINGS,
  timeDisplay: 'time',
  ripple: false,
  linkedSelection: true,
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

/** The clips an edit of `ids` applies to: with linked selection on, their linked partners too. */
export function editTargets(ids: readonly Id[]): Id[] {
  const { project, linkedSelection } = get()
  return linkedSelection ? withLinked(project, ids) : [...ids]
}

export function setPlayhead(frame: number): void {
  set({ playhead: Math.max(0, Math.round(frame)) })
}

export const MIN_ZOOM = 0.02
export const MAX_ZOOM = 40
export const setZoom = (zoom: number): void => set({ zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom)) })

export const selectTransition = (id: Id | null): void => set({ selectedTransition: id, selection: [] })

/** Changes snapping preferences and remembers them across sessions. */
export function setSnapSettings(patch: Partial<SnapSettings>): void {
  const snap = { ...get().snap, ...patch }
  set({ snap })
  void window.edion.settings.update({ snapping: { ...snap } })
}

export function setTimeDisplay(timeDisplay: TimeDisplay): void {
  set({ timeDisplay })
  void window.edion.settings.update({ timeDisplay })
}

/** Restores the view preferences kept in the settings file. */
export async function loadSnapSettings(): Promise<void> {
  const settings = await window.edion.settings.get()
  if (TIME_DISPLAYS.some((d) => d.value === settings.timeDisplay))
    set({ timeDisplay: settings.timeDisplay as TimeDisplay })
  const saved = settings.snapping
  if (saved) set({ snap: { ...DEFAULT_SNAP_SETTINGS, ...(saved as Partial<SnapSettings>) } })
}
