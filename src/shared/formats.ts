/** Export formats: container + codecs. Pure data, shared by the dialog, the main process and the export worker. */

export type VideoCodec = 'h264' | 'hevc' | 'av1' | 'vp9' | 'prores' | 'gif' | 'png'
export type AudioCodec = 'aac' | 'opus' | 'mp3' | 'pcm' | 'flac'

export type ExportFormatId =
  'mp4-h264' | 'mp4-hevc' | 'mp4-av1' | 'webm-vp9' | 'mov-prores' | 'gif' | 'png' | 'mp3' | 'wav' | 'flac'

export interface ExportFormat {
  id: ExportFormatId
  label: string
  group: 'Video' | 'Animation' | 'Audio' | 'Image'
  extension: string
  video: VideoCodec | null
  audio: AudioCodec | null
  /** A single frame (the one at the playhead) instead of a range. */
  still?: boolean
  /** Audio bitrate matters (lossy audio codec). */
  audioBitrate?: boolean
  hint?: string
}

export const EXPORT_FORMATS: readonly ExportFormat[] = [
  {
    id: 'mp4-h264',
    label: 'MP4 · H.264',
    group: 'Video',
    extension: 'mp4',
    video: 'h264',
    audio: 'aac',
    audioBitrate: true,
    hint: 'Plays everywhere'
  },
  {
    id: 'mp4-hevc',
    label: 'MP4 · H.265 (HEVC)',
    group: 'Video',
    extension: 'mp4',
    video: 'hevc',
    audio: 'aac',
    audioBitrate: true,
    hint: 'About half the size of H.264 at the same quality'
  },
  {
    id: 'mp4-av1',
    label: 'MP4 · AV1',
    group: 'Video',
    extension: 'mp4',
    video: 'av1',
    audio: 'aac',
    audioBitrate: true,
    hint: 'Smallest files; slow without a GPU encoder'
  },
  {
    id: 'webm-vp9',
    label: 'WebM · VP9',
    group: 'Video',
    extension: 'webm',
    video: 'vp9',
    audio: 'opus',
    audioBitrate: true,
    hint: 'For the web'
  },
  {
    id: 'mov-prores',
    label: 'MOV · ProRes 422',
    group: 'Video',
    extension: 'mov',
    video: 'prores',
    audio: 'pcm',
    hint: 'Near-lossless intermediate for other editors (large files)'
  },
  { id: 'gif', label: 'Animated GIF', group: 'Animation', extension: 'gif', video: 'gif', audio: null },
  {
    id: 'mp3',
    label: 'MP3',
    group: 'Audio',
    extension: 'mp3',
    video: null,
    audio: 'mp3',
    audioBitrate: true
  },
  { id: 'wav', label: 'WAV (16-bit)', group: 'Audio', extension: 'wav', video: null, audio: 'pcm' },
  { id: 'flac', label: 'FLAC', group: 'Audio', extension: 'flac', video: null, audio: 'flac' },
  {
    id: 'png',
    label: 'PNG · frame at playhead',
    group: 'Image',
    extension: 'png',
    video: 'png',
    audio: null,
    still: true
  }
]

export const DEFAULT_FORMAT: ExportFormatId = 'mp4-h264'

export const exportFormat = (id: string | undefined): ExportFormat =>
  EXPORT_FORMATS.find((f) => f.id === id) ?? EXPORT_FORMATS[0]!

/** Guesses the format from a file name (the first format with that extension wins). */
export function formatForPath(path: string): ExportFormatId {
  const extension = path.split('.').pop()?.toLowerCase()
  return EXPORT_FORMATS.find((f) => f.extension === extension)?.id ?? DEFAULT_FORMAT
}

export const VIDEO_CODEC_LABELS: Record<VideoCodec, string> = {
  h264: 'H.264',
  hevc: 'H.265',
  av1: 'AV1',
  vp9: 'VP9',
  prores: 'ProRes',
  gif: 'GIF',
  png: 'PNG'
}
