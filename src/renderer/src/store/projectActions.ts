import {
  addMedia,
  clipFromMedia,
  createProject,
  insertClipAuto,
  newId,
  parseProject,
  projectDuration,
  ProjectFormatError,
  serializeProject
} from '@core/index'
import type { Id, MediaAsset, Project } from '@core/index'
import type { ImportedMedia } from '@shared/ipc'
import { benefitsFromProxy, requestProxy } from '@/engine/proxies'
import { edit, isDirty, loadProject, markSaved, select, useEditor } from './editor'
import { confirm, toast } from './feedback'

const get = useEditor.getState

/** Asks what to do with unsaved work. Resolves false if the user backed out. */
export async function confirmDiscard(): Promise<boolean> {
  if (!isDirty()) return true
  const answer = await confirm({
    title: 'Save changes?',
    message: `“${get().project.name}” has unsaved changes.`,
    confirmLabel: 'Save',
    alternateLabel: "Don't save"
  })
  if (answer === 'cancel') return false
  if (answer === 'confirm') return saveProject()
  // Knowingly discarded work should not come back as a recovery offer.
  void window.edion.project.clearAutosave(get().project.id)
  return true
}

export async function newProject(): Promise<void> {
  if (!(await confirmDiscard())) return
  loadProject(createProject(), null)
}

async function adopt(project: Project, path: string | null, dirty = false): Promise<void> {
  loadProject(project, path, dirty)
  // Allow-list every media file with the main process, and find the ones that moved.
  const found = await window.edion.library.exists(project.media.map((m) => m.path))
  await Promise.all(project.media.filter((_, i) => found[i]).map((m) => window.edion.library.fileUrl(m.path)))
  const missing = project.media.filter((_, i) => !found[i]).map((m) => m.id)
  useEditor.setState({ missingMedia: missing })
  void prepareProxies(project.media.filter((_, i) => found[i]))
  if (missing.length > 0) {
    toast(
      `${missing.length} media file${missing.length > 1 ? 's are' : ' is'} missing. Relink from the library.`,
      'error'
    )
  }
}

export async function openProject(path?: string): Promise<void> {
  if (!(await confirmDiscard())) return
  try {
    const file = path ? await window.edion.project.read(path) : await window.edion.project.open()
    if (!file) return
    await adopt(parseProject(file.json), file.path)
  } catch (error) {
    toast(
      error instanceof ProjectFormatError ? error.message : `Could not open the project: ${String(error)}`,
      'error'
    )
  }
}

export async function recoverAutosave(projectId: string, originalPath: string | null): Promise<void> {
  try {
    await adopt(parseProject(await window.edion.project.readAutosave(projectId)), originalPath, true)
    toast('Recovered unsaved work', 'success')
  } catch (error) {
    toast(`Recovery failed: ${String(error)}`, 'error')
  }
}

export async function saveProject(saveAs = false): Promise<boolean> {
  const { project, path } = get()
  try {
    const json = serializeProject(project)
    const written =
      path && !saveAs
        ? await window.edion.project.save(path, json, project.name)
        : await window.edion.project.saveAs(project.name, json, project.name)
    if (!written) return false
    if (project.name === 'Untitled project') {
      const name = written
        .split(/[\\/]/)
        .pop()!
        .replace(/\.edion$/, '')
      useEditor.setState({ project: { ...get().project, name } })
    }
    markSaved(written)
    void window.edion.project.clearAutosave(project.id)
    return true
  } catch (error) {
    toast(`Could not save: ${String(error)}`, 'error')
    return false
  }
}

let lastAutosaved = -1

export async function autosave(): Promise<void> {
  const { project, path, revision } = get()
  if (!isDirty() || revision === lastAutosaved) return
  lastAutosaved = revision
  await window.edion.project
    .autosave({ projectId: project.id, name: project.name, originalPath: path }, serializeProject(project))
    .catch((error) => console.warn('autosave failed', error))
}

// ── Media ─────────────────────────────────────────────────────────────────────────────────────────

function toAsset({ kind, probe }: ImportedMedia): MediaAsset {
  const video = probe.streams.find((s) => s.kind === 'video')
  const audio = probe.streams.find((s) => s.kind === 'audio')
  const rotated = Math.abs(video?.rotation ?? 0) % 180 === 90
  return {
    id: newId(),
    kind,
    name: probe.path.split(/[\\/]/).pop() ?? probe.path,
    path: probe.path,
    size: probe.size,
    duration: kind === 'image' ? 0 : probe.duration,
    width: rotated ? video?.height : video?.width,
    height: rotated ? video?.width : video?.height,
    fps: kind === 'video' ? video?.fps : undefined,
    rotation: video?.rotation,
    videoCodec: video?.codec,
    audioCodec: audio?.codec,
    hasAudio: Boolean(audio)
  }
}

/** Imports files into the library (skipping ones already there). Returns the assets for the given paths. */
export async function importMedia(paths: string[]): Promise<MediaAsset[]> {
  if (paths.length === 0) return []
  const existing = new Map(get().project.media.map((m) => [m.path, m]))
  const results = await window.edion.library.import(paths.filter((p) => !existing.has(p)))
  const added: MediaAsset[] = []
  for (const result of results) {
    if ('error' in result) toast(`${result.path.split(/[\\/]/).pop()}: ${result.error}`, 'error')
    else added.push(toAsset(result))
  }
  if (added.length > 0) {
    const first = get().project.media.length === 0 && projectDuration(get().project) === 0
    edit('Import media', (draft) => {
      for (const asset of added) addMedia(draft, asset)
      // The first video sets the project format, like most editors do.
      const video = added.find((a) => a.kind === 'video' && a.width && a.height)
      if (first && video) {
        draft.settings.width = video.width! & ~1
        draft.settings.height = video.height! & ~1
        if (video.fps && video.fps >= 10 && video.fps <= 120)
          draft.settings.fps = Math.round(video.fps * 1000) / 1000
      }
    })
  }
  void prepareProxies(added)
  const all = new Map(get().project.media.map((m) => [m.path, m]))
  return paths.flatMap((p) => all.get(p) ?? [])
}

export async function importMediaDialog(): Promise<void> {
  await importMedia(await window.edion.dialog.openMedia())
}

/** Appends an asset at `frame` (default: the playhead). */
export function addAssetToTimeline(asset: MediaAsset, frame = get().playhead, trackId?: Id): void {
  let clipId: Id | null = null
  edit('Add to timeline', (draft) => {
    const clip = clipFromMedia(asset, frame, draft.settings.fps)
    insertClipAuto(draft, clip, trackId)
    clipId = clip.id
  })
  if (clipId) select([clipId])
}

export async function relinkMedia(mediaId: Id): Promise<void> {
  const asset = get().project.media.find((m) => m.id === mediaId)
  if (!asset) return
  const path = await window.edion.library.relink(asset.name)
  if (!path) return
  const [result] = await window.edion.library.import([path])
  if (!result || 'error' in result) return toast('That file could not be read', 'error')
  edit('Relink media', (draft) => {
    const target = draft.media.find((m) => m.id === mediaId)
    if (target) Object.assign(target, { ...toAsset(result), id: mediaId, name: target.name })
  })
  useEditor.setState({ missingMedia: get().missingMedia.filter((id) => id !== mediaId) })
}

/** Starts background proxy generation for heavy footage, when enabled in the settings. */
export async function prepareProxies(assets: readonly MediaAsset[]): Promise<void> {
  const heavy = assets.filter(benefitsFromProxy)
  if (heavy.length === 0 || !(await window.edion.settings.get()).proxiesEnabled) return
  for (const asset of heavy) void requestProxy(asset.path)
}
