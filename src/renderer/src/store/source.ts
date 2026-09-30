import { create } from 'zustand'
import { createProject, createTrack, clipFromMedia, findMedia } from '@core/index'
import type { Id, MediaAsset, Project } from '@core/index'
import { addAssetToTimeline, type PlaceMode } from './projectActions'
import { toast } from './feedback'
import { useEditor } from './editor'

/**
 * The source monitor: one media file on its own, with in and out marks, from which a part is placed on
 * the timeline (three-point editing). Frames here are frames of the source, at the project's rate.
 */
export interface SourceState {
  assetId: Id | null
  /** The viewer shows the source instead of the timeline. */
  active: boolean
  playhead: number
  playing: boolean
  markIn: number | null
  markOut: number | null
}

export const useSource = create<SourceState>(() => ({
  assetId: null,
  active: false,
  playhead: 0,
  playing: false,
  markIn: null,
  markOut: null
}))

const get = useSource.getState
const set = useSource.setState

export function openInSource(assetId: Id): void {
  useEditor.setState({ playing: false })
  set({ assetId, active: true, playhead: 0, playing: false, markIn: null, markOut: null })
}

export const showSource = (active: boolean): void => set({ active, playing: false })

export const sourceAsset = (): MediaAsset | undefined => {
  const { assetId } = get()
  return assetId ? findMedia(useEditor.getState().project, assetId) : undefined
}

/** Length of the source in frames. */
export function sourceLength(asset: MediaAsset | undefined = sourceAsset()): number {
  const { fps } = useEditor.getState().project.settings
  if (!asset) return 0
  return asset.duration > 0 ? Math.max(1, Math.floor(asset.duration * fps)) : Math.round(5 * fps)
}

/** A one-clip project showing the asset, so the regular player and renderer can play it. */
export function sourceProject(asset: MediaAsset, settings: Project['settings']): Project {
  const project = createProject('Source', { ...settings })
  project.media = [asset]
  const clip = clipFromMedia(asset, 0, settings.fps)
  project.tracks = [createTrack('video', 'Video'), createTrack('audio', 'Audio')]
  project.tracks[clip.type === 'audio' ? 1 : 0]!.clips.push(clip)
  return project
}

export function seekSource(frame: number): void {
  set({ playhead: Math.max(0, Math.min(sourceLength() - 1, Math.round(frame))) })
}

export const stepSource = (delta: number): void => {
  set({ playing: false })
  seekSource(get().playhead + delta)
}

export const toggleSourcePlayback = (): void => set((s) => ({ playing: !s.playing }))

/** I / O in the source monitor. The out mark is exclusive, like the timeline's. */
export function markSource(edge: 'in' | 'out'): void {
  const { playhead, markIn, markOut } = get()
  if (edge === 'in')
    set({ markIn: playhead, markOut: markOut !== null && markOut <= playhead ? null : markOut })
  else set({ markOut: playhead + 1, markIn: markIn !== null && markIn > playhead ? null : markIn })
}

/** Places the marked part of the source at the timeline playhead, then moves the playhead past it. */
export function placeSource(mode: PlaceMode): void {
  const asset = sourceAsset()
  if (!asset) return
  const { fps } = useEditor.getState().project.settings
  const { markIn, markOut } = get()
  const from = markIn ?? 0
  const to = markOut ?? sourceLength(asset)
  if (to <= from) return toast('The out mark comes before the in mark.', 'error')
  const at = useEditor.getState().playhead
  addAssetToTimeline(asset, at, undefined, mode, [from / fps, to / fps])
  useEditor.setState({ playhead: at + (to - from) })
}
