import { PROJECT_VERSION } from './schema'
import type {
  AdjustmentClip,
  AudioClip,
  CaptionClip,
  ImageClip,
  MediaAsset,
  Project,
  ProjectSettings,
  ShapeClip,
  TextClip,
  TextStyle,
  Track,
  TrackKind,
  Transform,
  VideoClip
} from './types'

export const newId = (): string => crypto.randomUUID().replace(/-/g, '').slice(0, 12)

export const DEFAULT_SETTINGS: ProjectSettings = {
  width: 1920,
  height: 1080,
  fps: 30,
  sampleRate: 48000,
  background: '#000000'
}

export const DEFAULT_TEXT_STYLE: TextStyle = {
  fontFamily: 'Inter',
  fontSize: 96,
  fontWeight: 700,
  italic: false,
  color: '#ffffff',
  align: 'center',
  lineHeight: 1.2,
  letterSpacing: 0,
  strokeColor: '#000000',
  strokeWidth: 0,
  shadowColor: '#00000099',
  shadowBlur: 0,
  shadowOffset: [0, 4],
  backgroundColor: '#00000000',
  backgroundPadding: 16,
  backgroundRadius: 8
}

export const DEFAULT_CAPTION_STYLE: TextStyle = {
  ...DEFAULT_TEXT_STYLE,
  fontSize: 48,
  fontWeight: 600,
  backgroundColor: '#000000b3'
}

export const DEFAULT_STILL_SECONDS = 5

export const defaultTransform = (): Transform => ({
  position: { value: [0, 0] },
  scale: { value: [1, 1] },
  rotation: { value: 0 },
  opacity: { value: 1 },
  anchor: [0.5, 0.5]
})

export function createTrack(kind: TrackKind, name: string): Track {
  return {
    id: newId(),
    kind,
    name,
    clips: [],
    transitions: [],
    muted: false,
    solo: false,
    hidden: false,
    locked: false,
    height: kind === 'video' ? 64 : 48
  }
}

export function createProject(name = 'Untitled project', settings: Partial<ProjectSettings> = {}): Project {
  return {
    app: 'edion',
    version: PROJECT_VERSION,
    id: newId(),
    name,
    settings: { ...DEFAULT_SETTINGS, ...settings },
    media: [],
    tracks: [createTrack('video', 'Video 1'), createTrack('audio', 'Audio 1')],
    markers: [],
    captionStyle: { ...DEFAULT_CAPTION_STYLE },
    range: null
  }
}

const visualDefaults = () => ({
  transform: defaultTransform(),
  blendMode: 'normal' as const,
  effects: []
})
const audibleDefaults = () => ({ volume: { value: 1 }, fadeIn: 0, fadeOut: 0 })
const noCrop = () => ({ left: 0, top: 0, right: 0, bottom: 0 })

/** Creates the clip that represents `asset` on the timeline, at its full length. */
export function clipFromMedia(
  asset: MediaAsset,
  start: number,
  fps: number
): VideoClip | AudioClip | ImageClip {
  const base = { id: newId(), name: asset.name, start }
  const duration = Math.max(1, Math.floor(asset.duration * fps))
  switch (asset.kind) {
    case 'video':
      return {
        ...base,
        ...visualDefaults(),
        ...audibleDefaults(),
        type: 'video',
        duration,
        mediaId: asset.id,
        sourceIn: 0,
        speed: 1,
        crop: noCrop(),
        audioMuted: !asset.hasAudio
      }
    case 'audio':
      return {
        ...base,
        ...audibleDefaults(),
        type: 'audio',
        duration,
        mediaId: asset.id,
        sourceIn: 0,
        speed: 1
      }
    case 'image':
      return {
        ...base,
        ...visualDefaults(),
        type: 'image',
        duration: Math.round(DEFAULT_STILL_SECONDS * fps),
        mediaId: asset.id,
        crop: noCrop()
      }
  }
}

export function createTextClip(start: number, fps: number, text = 'Your text'): TextClip {
  return {
    id: newId(),
    name: text,
    start,
    duration: Math.round(DEFAULT_STILL_SECONDS * fps),
    ...visualDefaults(),
    type: 'text',
    text,
    style: { ...DEFAULT_TEXT_STYLE },
    boxWidth: 0
  }
}

export function createShapeClip(start: number, fps: number, shape: ShapeClip['shape']): ShapeClip {
  return {
    id: newId(),
    name: shape === 'rect' ? 'Rectangle' : 'Ellipse',
    start,
    duration: Math.round(DEFAULT_STILL_SECONDS * fps),
    ...visualDefaults(),
    type: 'shape',
    shape,
    size: [480, 270],
    fill: '#6d8cff',
    strokeColor: '#ffffff',
    strokeWidth: 0,
    cornerRadius: 0
  }
}

export function createCaptionClip(start: number, duration: number, text: string): CaptionClip {
  return {
    id: newId(),
    name: text.slice(0, 40),
    type: 'caption',
    start,
    duration: Math.max(1, duration),
    text
  }
}

export function createAdjustmentClip(start: number, fps: number): AdjustmentClip {
  return {
    id: newId(),
    name: 'Adjustment layer',
    type: 'adjustment',
    start,
    duration: Math.round(DEFAULT_STILL_SECONDS * fps),
    opacity: { value: 1 },
    effects: []
  }
}
