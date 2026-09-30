/** Typed contract between main, preload and renderer. */

import type { ExportFormatId, VideoCodec } from './formats'

export interface FfmpegInfo {
  ffmpegPath: string
  ffprobePath: string
  version: string
  source: 'custom' | 'bundled' | 'system'
}

export interface MediaStreamInfo {
  index: number
  kind: 'video' | 'audio' | 'other'
  codec: string
  width?: number
  height?: number
  fps?: number
  rotation?: number
  pixelFormat?: string
  sampleRate?: number
  channels?: number
}

export interface MediaProbe {
  path: string
  size: number
  duration: number
  format: string
  streams: MediaStreamInfo[]
}

/** API exposed on `window.edion` in the editor window. */
export interface EdionApi {
  /** The window is about to close; call `confirmClose()` once unsaved work has been dealt with. */
  onCloseRequested(cb: () => void): () => void
  confirmClose(): void
  /** Puts text on the system clipboard (works without window focus, unlike the web clipboard API). */
  copyText(text: string): void
  platform: string
  /** True in automated and driven runs (`EDION_SCREENSHOT`, `EDION_DRIVE`), which expose `window.__edion`. */
  automated: boolean
  ffmpeg: {
    info(): Promise<FfmpegInfo>
    probe(path: string): Promise<MediaProbe>
  }
  dialog: {
    openMedia(): Promise<string[]>
    saveFile(defaultName: string, extensions: string[]): Promise<string | null>
    chooseFolder(): Promise<string | null>
    openText(extensions: string[]): Promise<{ path: string; content: string } | null>
    saveText(defaultName: string, extensions: string[], content: string): Promise<string | null>
  }
  media: {
    /** Registers a path as readable and returns its size. */
    open(path: string): Promise<number>
    /** Ranged read of a registered media file, straight from disk. */
    read(path: string, start: number, end: number): Promise<Uint8Array>
    pathForFile(file: File): string
  }
  export: EdionApiExport
  project: EdionProjectApi
  library: EdionMediaLibraryApi
  settings: EdionSettingsApi
}

export const IPC = {
  ffmpegInfo: 'ffmpeg:info',
  ffmpegProbe: 'ffmpeg:probe',
  dialogOpenMedia: 'dialog:openMedia',
  dialogSaveFile: 'dialog:saveFile',
  dialogOpenText: 'dialog:openText',
  dialogChooseFolder: 'dialog:chooseFolder',
  closeRequested: 'app:closeRequested',
  closeConfirmed: 'app:closeConfirmed',
  copyText: 'app:copyText',
  dialogSaveText: 'dialog:saveText'
} as const

// ── Export ─────────────────────────────────────────────────────────────────────────────────────────

export type ExportQuality = 'high' | 'medium' | 'low'

export interface ExportSettings {
  /** Container and codecs; see EXPORT_FORMATS. */
  format: ExportFormatId
  /** For still formats: the frame to render. */
  frame?: number
  /** Output size; must have the project's aspect ratio. */
  width: number
  height: number
  /** Frame range to export, or null for the whole timeline. */
  range: { in: number; out: number } | null
  /** 'auto' prefers hardware, 'software' forces the software encoder, otherwise an encoder name. */
  encoder: string
  quality: ExportQuality
  audioBitrateKbps: number
}

export interface ExportRequest {
  projectJson: string
  name: string
  outputPath: string
  settings: ExportSettings
}

export interface EncoderInfo {
  name: string
  label: string
  hardware: boolean
  codec: VideoCodec
}

/** An encoder plus everything needed to invoke it. */
export interface ResolvedEncoder extends EncoderInfo {
  ffmpegPath: string
  /** Global options placed before the inputs (e.g. the VAAPI device). */
  globalArgs: string[]
  /** Appended to the colour-conversion filter chain (e.g. `format=nv12,hwupload`). */
  filterSuffix: string
  /** Codec options per quality level. */
  codecArgs: Record<ExportQuality, string[]>
  /** Software pixel format, or null when frames are uploaded to the GPU by the filter chain. */
  pixelFormat: string | null
}

export interface ExportJobState {
  id: string
  name: string
  outputPath: string
  state: 'queued' | 'running' | 'done' | 'error' | 'cancelled'
  phase: 'audio' | 'video' | 'finishing'
  frame: number
  totalFrames: number
  startedAt: number | null
  finishedAt: number | null
  encoder: string | null
  message?: string
}

export type ExportProgress = Pick<ExportJobState, 'phase' | 'frame' | 'totalFrames'> &
  Partial<Pick<ExportJobState, 'encoder' | 'message'>> & { state: 'running' | 'done' | 'error' | 'cancelled' }

export interface EncoderStart {
  width: number
  height: number
  fps: string
  outputPath: string
  format: ExportFormatId
  /** Null for audio-only formats. */
  encoder: ResolvedEncoder | null
  quality: ExportQuality
  /** Raw interleaved f32le stereo mixdown, or null for a silent project. */
  audio: { path: string; sampleRate: number; bitrateKbps: number } | null
}

/** API exposed on `window.edionExport` in the hidden export window. */
export interface EdionExportApi {
  media: EdionApi['media']
  library: Pick<EdionMediaLibraryApi, 'fileUrl' | 'proxy'>
  /** The request plus encoders to try, in order (the last one is software; none for audio-only formats). */
  getJob(): Promise<{ request: ExportRequest; encoders: ResolvedEncoder[] }>
  beginAudio(): Promise<string>
  appendAudio(interleaved: Float32Array): Promise<void>
  endAudio(): Promise<void>
  startEncoder(start: EncoderStart): Promise<void>
  /** Resolves once FFmpeg has accepted the frame (applies backpressure). */
  writeFrame(rgba: Uint8Array): Promise<void>
  finish(): Promise<void>
  /** Kills the encoder and deletes the partial output (before a retry, or on abort). */
  discardEncoder(): Promise<void>
  cleanup(): Promise<void>
  progress(p: ExportProgress): void
  onAbort(cb: () => void): void
}

export const EXPORT_IPC = {
  start: 'export:start',
  cancel: 'export:cancel',
  list: 'export:list',
  clear: 'export:clear',
  reveal: 'export:reveal',
  encoders: 'export:encoders',
  update: 'export:update',
  getJob: 'export:getJob',
  progress: 'export:progress',
  abort: 'export:abort'
} as const

export interface EdionApiExport {
  start(request: ExportRequest): Promise<string>
  cancel(jobId: string): Promise<void>
  list(): Promise<ExportJobState[]>
  clearFinished(): Promise<void>
  reveal(path: string): Promise<void>
  /** Working encoders for a codec, hardware first; empty when this FFmpeg cannot encode it. */
  encoders(codec: VideoCodec): Promise<EncoderInfo[]>
  onUpdate(cb: (jobs: ExportJobState[]) => void): () => void
}

// ── Projects, settings, media cache ─────────────────────────────────────────────────────────────────

export interface RecentProject {
  path: string
  name: string
  openedAt: number
}

export interface AppSettings {
  /** Directory holding custom ffmpeg/ffprobe binaries, or null for bundled. */
  ffmpegDir: string | null
  autosaveSeconds: number
  proxiesEnabled: boolean
  /** Custom key bindings: command id → key combos. Commands not listed use their defaults. */
  shortcuts: Record<string, string[]>
  /** Timeline snapping preferences (a `SnapSettings` from the core); null until changed. */
  snapping: Record<string, number | boolean> | null
  /** How positions are displayed: 'time' | 'timecode' | 'frames'. */
  timeDisplay: string
  /** Named effect stacks saved by the user (core `Effect` objects). */
  effectPresets: EffectPreset[]
  recents: RecentProject[]
}

export interface EffectPreset {
  name: string
  /** Core `Effect`s; plain JSON here so the IPC contract does not depend on the core. */
  effects: Array<{ type: string; enabled: boolean; params: Record<string, unknown>; resource?: string }>
}

export interface ProjectFile {
  path: string
  json: string
}

export interface AutosaveInfo {
  projectId: string
  name: string
  savedAt: number
  /** Where the project normally lives, if it was ever saved. */
  originalPath: string | null
}

/** What the renderer needs to turn a file into a MediaAsset. */
export interface ImportedMedia {
  kind: 'video' | 'audio' | 'image'
  probe: MediaProbe
}

export interface Filmstrip {
  /** `edion-file://` URL of a single-row sprite sheet. */
  url: string
  count: number
  /** Seconds between tiles. */
  interval: number
  tileWidth: number
  tileHeight: number
}

/** Peak amplitude (0-255) per bucket, mono mixdown. */
export interface Peaks {
  perSecond: number
  data: Uint8Array
}

export interface EdionProjectApi {
  open(): Promise<ProjectFile | null>
  read(path: string): Promise<ProjectFile>
  /** Atomic write. Returns the path written. */
  save(path: string, json: string, name: string): Promise<string>
  saveAs(defaultName: string, json: string, name: string): Promise<string | null>
  autosave(info: Omit<AutosaveInfo, 'savedAt'>, json: string): Promise<void>
  listAutosaves(): Promise<AutosaveInfo[]>
  readAutosave(projectId: string): Promise<string>
  clearAutosave(projectId: string): Promise<void>
  setTitle(title: string, dirty: boolean): void
  /** Project passed on the command line / opened from the file manager, if any. */
  initialPath(): Promise<string | null>
}

export interface EdionMediaLibraryApi {
  import(paths: string[]): Promise<Array<ImportedMedia | { error: string; path: string }>>
  exists(paths: string[]): Promise<boolean[]>
  relink(missingName: string): Promise<string | null>
  fileUrl(path: string): Promise<string>
  filmstrip(path: string): Promise<Filmstrip | null>
  peaks(path: string): Promise<Peaks | null>
  /**
   * Path of an easily decodable stand-in for a media file, generating it on first use.
   * 'preview' is small and fast; 'full' keeps the resolution and is near-lossless (used when exporting
   * sources the app cannot decode itself).
   */
  proxy(path: string, mode: ProxyMode): Promise<string | null>
  /** Saves a microphone recording next to the project (or in app data) and returns the audio file's path. */
  saveRecording(data: Uint8Array, projectPath: string | null): Promise<string>
  cacheSize(): Promise<number>
  clearCache(): Promise<void>
  /**
   * Copies files into `folder` (keeping names, adding a suffix on clashes) and returns old path → new
   * path for each file copied. Files already in the folder are left where they are.
   */
  collect(paths: string[], folder: string): Promise<Record<string, string>>
  /**
   * Writes a processed copy of a media file with the same timing (next to the project, or in app data
   * when unsaved) and returns its path. Reuses an existing copy made with the same settings.
   */
  derive(path: string, kind: DeriveKind, strength: number, projectPath: string | null): Promise<string>
  /** Source times where the picture cuts to a new shot (scene score above `threshold`, 0-1). */
  scenes(path: string, start: number, duration: number, threshold: number): Promise<number[]>
  /** Pauses quieter than `thresholdDb` lasting at least `minSeconds`, as [start, end] source seconds. */
  silences(
    path: string,
    start: number,
    duration: number,
    thresholdDb: number,
    minSeconds: number
  ): Promise<Array<[number, number]>>
  /** EBU R128 loudness of `duration` seconds from `start`, or null when it cannot be measured. */
  loudness(
    path: string,
    start: number,
    duration: number
  ): Promise<{ integrated: number; peak: number } | null>
}

export type ProxyMode = 'preview' | 'full'

/** Processed copies of media: video stabilisation, audio noise reduction. */
export type DeriveKind = 'stabilize' | 'denoise'

export interface EdionSettingsApi {
  get(): Promise<AppSettings>
  update(patch: Partial<Omit<AppSettings, 'recents'>>): Promise<AppSettings>
}

export const PROJECT_IPC = {
  open: 'project:open',
  read: 'project:read',
  save: 'project:save',
  saveAs: 'project:saveAs',
  autosave: 'project:autosave',
  listAutosaves: 'project:listAutosaves',
  readAutosave: 'project:readAutosave',
  clearAutosave: 'project:clearAutosave',
  setTitle: 'project:setTitle',
  initialPath: 'project:initialPath'
} as const

export const LIBRARY_IPC = {
  import: 'library:import',
  exists: 'library:exists',
  relink: 'library:relink',
  fileUrl: 'library:fileUrl',
  filmstrip: 'library:filmstrip',
  peaks: 'library:peaks',
  proxy: 'library:proxy',
  saveRecording: 'library:saveRecording',
  cacheSize: 'library:cacheSize',
  clearCache: 'library:clearCache',
  loudness: 'library:loudness',
  collect: 'library:collect',
  silences: 'library:silences',
  derive: 'library:derive',
  scenes: 'library:scenes'
} as const

export const SETTINGS_IPC = { get: 'settings:get', update: 'settings:update' } as const

export const FILE_PROTOCOL = 'edion-file'
export const PROJECT_EXTENSION = 'edion'
