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
