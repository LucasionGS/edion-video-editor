/** Typed contract between main, preload and renderer. */

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

export interface ExportSpikeRequest {
  inputPath: string
  outputPath: string
}

export interface ExportProgress {
  jobId: string
  frame: number
  totalFrames: number
  state: 'running' | 'done' | 'error' | 'cancelled'
  message?: string
}

/** API exposed on `window.edion` in the editor window. */
export interface EdionApi {
  platform: string
  ffmpeg: {
    info(): Promise<FfmpegInfo>
    probe(path: string): Promise<MediaProbe>
  }
  dialog: {
    openMedia(): Promise<string[]>
    saveFile(defaultName: string, extensions: string[]): Promise<string | null>
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
  dialogSaveFile: 'dialog:saveFile'
} as const

export interface ExportJob {
  id: string
  inputPath: string
  outputPath: string
}

/** API exposed on `window.edionExport` in the hidden export window. */
export interface EdionExportApi {
  media: EdionApi['media']
  getJob(): Promise<ExportJob>
  startEncoder(opts: EncoderOptions): Promise<void>
  /** Resolves once FFmpeg has accepted the frame (applies backpressure). */
  writeFrame(rgba: Uint8Array): Promise<void>
  finish(): Promise<void>
  progress(p: Omit<ExportProgress, 'jobId'>): void
  onAbort(cb: () => void): void
}

export interface EncoderOptions {
  width: number
  height: number
  fps: number
  outputPath: string
  /** Optional file whose audio streams are muxed in. */
  audioPath?: string
  videoCodec?: string
  videoArgs?: string[]
}

export const EXPORT_IPC = {
  start: 'export:start',
  cancel: 'export:cancel',
  getJob: 'export:getJob',
  progress: 'export:progress',
  abort: 'export:abort'
} as const

export interface EdionApiExport {
  start(job: Omit<ExportJob, 'id'>): Promise<string>
  cancel(jobId: string): Promise<void>
  onProgress(cb: (p: ExportProgress) => void): () => void
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
  recents: RecentProject[]
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
}

export interface EdionMediaLibraryApi {
  import(paths: string[]): Promise<Array<ImportedMedia | { error: string; path: string }>>
  exists(paths: string[]): Promise<boolean[]>
  relink(missingName: string): Promise<string | null>
  fileUrl(path: string): Promise<string>
  filmstrip(path: string): Promise<Filmstrip | null>
  peaks(path: string): Promise<Peaks | null>
}

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
  setTitle: 'project:setTitle'
} as const

export const LIBRARY_IPC = {
  import: 'library:import',
  exists: 'library:exists',
  relink: 'library:relink',
  fileUrl: 'library:fileUrl',
  filmstrip: 'library:filmstrip',
  peaks: 'library:peaks'
} as const

export const SETTINGS_IPC = { get: 'settings:get', update: 'settings:update' } as const

export const FILE_PROTOCOL = 'edion-file'
export const PROJECT_EXTENSION = 'edion'
