import type { z } from 'zod'
import type * as s from './schema'

export type Id = string
export type Vec2 = [number, number]
export type Easing = z.infer<typeof s.easingSchema>
export interface Keyframe<T> {
  frame: number
  value: T
  easing: Easing
}
export interface Animatable<T> {
  value: T
  keyframes?: Keyframe<T>[]
}
export type AnimValue = number | Vec2

export type Transform = z.infer<typeof s.transformSchema>
export type Crop = z.infer<typeof s.cropSchema>
export type BlendMode = z.infer<typeof s.blendModeSchema>
export type Effect = z.infer<typeof s.effectSchema>
export type TextStyle = z.infer<typeof s.textStyleSchema>

export type VideoClip = z.infer<typeof s.videoClipSchema>
export type AudioClip = z.infer<typeof s.audioClipSchema>
export type ImageClip = z.infer<typeof s.imageClipSchema>
export type TextClip = z.infer<typeof s.textClipSchema>
export type ShapeClip = z.infer<typeof s.shapeClipSchema>
export type CaptionClip = z.infer<typeof s.captionClipSchema>
export type AdjustmentClip = z.infer<typeof s.adjustmentClipSchema>
export type CompoundClip = z.infer<typeof s.compoundClipSchema>
export type Sequence = z.infer<typeof s.sequenceSchema>
export type Clip = z.infer<typeof s.clipSchema>
export type ClipType = Clip['type']
export type VisualClip = VideoClip | ImageClip | TextClip | ShapeClip | CompoundClip
export type AudibleClip = VideoClip | AudioClip

export type Transition = z.infer<typeof s.transitionSchema>
export type Track = z.infer<typeof s.trackSchema>
export type TrackKind = Track['kind']
export type MediaAsset = z.infer<typeof s.mediaAssetSchema>
export type ProjectSettings = z.infer<typeof s.projectSettingsSchema>
export type Marker = z.infer<typeof s.markerSchema>
export type Project = z.infer<typeof s.projectSchema>

export const isVisualClip = (clip: Clip): clip is VisualClip =>
  clip.type === 'video' ||
  clip.type === 'image' ||
  clip.type === 'text' ||
  clip.type === 'shape' ||
  clip.type === 'compound'
/** Clips with an effect stack (layers and adjustment layers). */
export const hasEffects = (clip: Clip): clip is VisualClip | AdjustmentClip =>
  isVisualClip(clip) || clip.type === 'adjustment'
export const isAudibleClip = (clip: Clip): clip is AudibleClip =>
  clip.type === 'video' || clip.type === 'audio'

/** Which track kind a clip type lives on. */
export const trackKindFor = (type: ClipType): TrackKind =>
  type === 'audio' ? 'audio' : type === 'caption' ? 'caption' : 'video'
