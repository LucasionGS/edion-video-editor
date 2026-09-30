import { z } from 'zod'

/** Project file schema. Types are derived from it so validation and typing can never drift apart. */

export const PROJECT_VERSION = 1

const id = z.string().min(1)
const frames = z.number().int()
const vec2 = z.tuple([z.number(), z.number()])

export const easingSchema = z.union([
  z.enum(['linear', 'easeIn', 'easeOut', 'easeInOut', 'hold']),
  z.object({ bezier: z.tuple([z.number(), z.number(), z.number(), z.number()]) })
])

const animatable = <T extends z.ZodType>(value: T) =>
  z.object({
    value,
    /** Sorted by frame; frames are relative to the clip start. */
    keyframes: z.array(z.object({ frame: frames, value, easing: easingSchema })).optional()
  })

export const animNumberSchema = animatable(z.number())
export const animVec2Schema = animatable(vec2)

export const transformSchema = z.object({
  /** Offset of the anchor from the canvas centre, in project pixels. */
  position: animVec2Schema,
  /** 1 = the layer's natural size (media is fitted into the canvas first). */
  scale: animVec2Schema,
  /** Degrees, clockwise. */
  rotation: animNumberSchema,
  opacity: animNumberSchema,
  /** Normalised pivot inside the layer, [0.5, 0.5] = centre. */
  anchor: vec2
})

export const cropSchema = z.object({
  left: z.number(),
  top: z.number(),
  right: z.number(),
  bottom: z.number()
})

export const blendModeSchema = z.enum(['normal', 'add', 'multiply', 'screen', 'overlay', 'darken', 'lighten'])

export const effectSchema = z.object({
  id,
  type: z.string(),
  enabled: z.boolean(),
  params: z.record(z.string(), animNumberSchema),
  /** Path of a file the effect reads (the .cube file of a LUT). */
  resource: z.string().optional()
})

export const textStyleSchema = z.object({
  fontFamily: z.string(),
  fontSize: z.number(),
  fontWeight: z.number(),
  italic: z.boolean(),
  color: z.string(),
  align: z.enum(['left', 'center', 'right']),
  lineHeight: z.number(),
  letterSpacing: z.number(),
  strokeColor: z.string(),
  strokeWidth: z.number(),
  shadowColor: z.string(),
  shadowBlur: z.number(),
  shadowOffset: vec2,
  backgroundColor: z.string(),
  backgroundPadding: z.number(),
  backgroundRadius: z.number()
})

const clipBase = {
  id,
  name: z.string(),
  start: frames,
  duration: frames.min(1),
  /** Clips sharing a link id (a video and its detached audio) move, trim, split and delete together. */
  linkId: id.optional(),
  /** Colour label shown on the timeline (a CSS colour), for organising. */
  color: z.string().optional(),
  /** Switched off: stays on the timeline but is neither seen nor heard. */
  disabled: z.boolean().optional()
}
const visual = {
  transform: transformSchema,
  blendMode: blendModeSchema,
  effects: z.array(effectSchema)
}
const timed = {
  mediaId: id,
  /** Offset into the source, in seconds. */
  sourceIn: z.number().min(0),
  speed: z.number().positive(),
  /** Plays its source range backwards. `sourceIn` still marks the earliest source time used. */
  reversed: z.boolean().optional()
}
const audible = {
  volume: animNumberSchema,
  /** Audio fades, in frames. */
  fadeIn: frames.min(0),
  fadeOut: frames.min(0),
  /** Stereo balance, -1 (left) … 1 (right). */
  pan: z.number().min(-1).max(1).optional(),
  /** Filters and dynamics, applied in order (see AUDIO_EFFECTS). */
  audioEffects: z.array(effectSchema).optional()
}

export const videoClipSchema = z.object({
  ...clipBase,
  ...visual,
  ...timed,
  ...audible,
  type: z.literal('video'),
  crop: cropSchema,
  /** True once the audio was detached into its own clip (or the source has none). */
  audioMuted: z.boolean(),
  /** A frame hold: shows the source frame at `sourceIn` for the whole clip, silently. */
  hold: z.boolean().optional(),
  /**
   * Time remapping: a keyframeable multiplier on `speed`. The clip keeps its length and uses more or less
   * of its source; its sound is muted while a ramp is active.
   */
  speedRamp: animNumberSchema.optional()
})
export const audioClipSchema = z.object({ ...clipBase, ...timed, ...audible, type: z.literal('audio') })
export const imageClipSchema = z.object({
  ...clipBase,
  ...visual,
  type: z.literal('image'),
  mediaId: id,
  crop: cropSchema
})
export const textClipSchema = z.object({
  ...clipBase,
  ...visual,
  type: z.literal('text'),
  text: z.string(),
  style: textStyleSchema,
  /** Wrap width in project pixels; 0 = no wrapping. */
  boxWidth: z.number(),
  /** Types the text on over the first `seconds` of the clip, letter by letter or word by word. */
  reveal: z.object({ mode: z.enum(['letters', 'words']), seconds: z.number().positive() }).optional()
})
export const shapeClipSchema = z.object({
  ...clipBase,
  ...visual,
  type: z.literal('shape'),
  shape: z.enum(['rect', 'ellipse']),
  size: vec2,
  fill: z.string(),
  strokeColor: z.string(),
  strokeWidth: z.number(),
  cornerRadius: z.number()
})
export const captionClipSchema = z.object({ ...clipBase, type: z.literal('caption'), text: z.string() })
/**
 * A nested sequence used as one clip: it shows (and plays) its sequence from `offset` frames on, with its
 * own transform and effects on top.
 */
export const compoundClipSchema = z.object({
  ...clipBase,
  ...visual,
  type: z.literal('compound'),
  sequenceId: id,
  /** Frames into the sequence where the clip starts. */
  offset: frames.min(0),
  /** Linear gain on everything the sequence plays. */
  volume: z.number().min(0)
})

/** Applies its effects to everything below it on the timeline, faded in by its opacity. */
export const adjustmentClipSchema = z.object({
  ...clipBase,
  type: z.literal('adjustment'),
  opacity: animNumberSchema,
  effects: z.array(effectSchema)
})

export const clipSchema = z.discriminatedUnion('type', [
  videoClipSchema,
  audioClipSchema,
  imageClipSchema,
  textClipSchema,
  shapeClipSchema,
  captionClipSchema,
  adjustmentClipSchema,
  compoundClipSchema
])

export const transitionSchema = z.object({
  id,
  type: z.string(),
  /** Total length in frames, centred on the cut between the two clips. */
  duration: frames.min(2),
  leftClipId: id,
  rightClipId: id
})

export const trackSchema = z.object({
  id,
  kind: z.enum(['video', 'audio', 'caption']),
  name: z.string(),
  /** Never overlapping, sorted by start. */
  clips: z.array(clipSchema),
  transitions: z.array(transitionSchema),
  muted: z.boolean(),
  solo: z.boolean(),
  hidden: z.boolean(),
  locked: z.boolean(),
  height: z.number(),
  /** Linear gain for everything on the track (1 = unchanged). */
  volume: z.number().min(0).optional(),
  /** Stereo balance of the whole track, -1 … 1. */
  pan: z.number().min(-1).max(1).optional()
})

export const mediaAssetSchema = z.object({
  id,
  kind: z.enum(['video', 'audio', 'image']),
  name: z.string(),
  path: z.string(),
  size: z.number(),
  /** Seconds; 0 for stills. */
  duration: z.number(),
  width: z.number().optional(),
  height: z.number().optional(),
  fps: z.number().optional(),
  rotation: z.number().optional(),
  videoCodec: z.string().optional(),
  audioCodec: z.string().optional(),
  hasAudio: z.boolean()
})

export const projectSettingsSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().positive(),
  sampleRate: z.number().int().positive(),
  background: z.string()
})

/** The contents of compound clips: tracks, like the main timeline's, timed from 0. */
export const sequenceSchema = z.object({ id, name: z.string(), tracks: z.array(trackSchema) })

export const markerSchema = z.object({ id, frame: frames, label: z.string(), color: z.string() })

export const projectSchema = z.object({
  app: z.literal('edion'),
  version: z.number().int(),
  id,
  name: z.string(),
  settings: projectSettingsSchema,
  media: z.array(mediaAssetSchema),
  /** Top of the list = top of the timeline = rendered last (in front). */
  tracks: z.array(trackSchema),
  markers: z.array(markerSchema),
  captionStyle: textStyleSchema,
  /** Export range in frames, if set. */
  range: z.object({ in: frames, out: frames }).nullable(),
  /** Nested sequences behind compound clips. */
  sequences: z.array(sequenceSchema).optional()
})
