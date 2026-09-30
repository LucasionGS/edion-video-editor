import { evaluate, isAnimated } from '../keyframes/animatable'
import type { Animatable, AnimValue, Clip, Id, MediaAsset, Project, Track, VideoClip } from '../model/types'
import { isAudibleClip, isVisualClip } from '../model/types'

export interface ClipLocation {
  track: Track
  clip: Clip
  index: number
}

export function findClip(project: Project, clipId: Id): ClipLocation | undefined {
  for (const track of project.tracks) {
    const index = track.clips.findIndex((c) => c.id === clipId)
    if (index >= 0) return { track, clip: track.clips[index]!, index }
  }
  return undefined
}

export const findTrack = (project: Project, trackId: Id): Track | undefined =>
  project.tracks.find((t) => t.id === trackId)

export const findMedia = (project: Project, mediaId: Id): MediaAsset | undefined =>
  project.media.find((m) => m.id === mediaId)

export const clipEnd = (clip: Clip): number => clip.start + clip.duration

/** The timeline's tracks plus those of every nested sequence (for bookkeeping over all clips). */
export const allTracks = (project: Pick<Project, 'tracks' | 'sequences'>): Track[] => [
  ...project.tracks,
  ...(project.sequences ?? []).flatMap((s) => s.tracks)
]

/** Length of a nested sequence in frames (end of its last clip). */
export function sequenceDuration(sequence: Pick<Project, 'tracks'>): number {
  return projectDuration(sequence)
}

/** Length of the timeline in frames (end of the last clip). */
export function projectDuration(project: Pick<Project, 'tracks'>): number {
  let end = 0
  for (const track of project.tracks) {
    const last = track.clips[track.clips.length - 1]
    if (last) end = Math.max(end, clipEnd(last))
  }
  return end
}

export function clipAtFrame(track: Track, frame: number): Clip | undefined {
  return track.clips.find((c) => frame >= c.start && frame < clipEnd(c))
}

/** True if [start, start+duration) is free on the track, ignoring `ignore` clips. */
export function isFree(
  track: Track,
  start: number,
  duration: number,
  ignore: ReadonlySet<Id> = new Set()
): boolean {
  if (start < 0) return false
  const end = start + duration
  return track.clips.every((c) => ignore.has(c.id) || c.start >= end || clipEnd(c) <= start)
}

/** Closest start to `desired` where a clip of `duration` fits on the track. */
export function nearestFreeStart(
  track: Track,
  desired: number,
  duration: number,
  ignore: ReadonlySet<Id> = new Set()
): number {
  const clips = track.clips.filter((c) => !ignore.has(c.id))
  const candidates: number[] = []
  let gapStart = 0
  for (const clip of clips) {
    if (clip.start - gapStart >= duration) {
      candidates.push(Math.min(Math.max(desired, gapStart), clip.start - duration))
    }
    gapStart = clipEnd(clip)
  }
  candidates.push(Math.max(desired, gapStart))
  return candidates.reduce((best, c) => (Math.abs(c - desired) < Math.abs(best - desired) ? c : best))
}

export type TimedClip = Extract<Clip, { sourceIn: number }>

export const isHold = (clip: Clip): boolean => clip.type === 'video' && clip.hold === true

/** True when a speed ramp changes the clip's playback (reversed clips and holds ignore ramps). */
export function hasRamp(clip: Clip): boolean {
  if (clip.type !== 'video' || !clip.speedRamp || clip.hold || clip.reversed) return false
  return isAnimated(clip.speedRamp) || clip.speedRamp.value !== 1
}

/** Playback speed at a clip-relative frame: `speed`, times the ramp when there is one. */
export function speedAt(clip: TimedClip, frame: number): number {
  if (!hasRamp(clip) || clip.type !== 'video') return clip.speed
  return clip.speed * Math.max(0.01, evaluate(clip.speedRamp!, frame))
}

/**
 * Running totals of source seconds per frame (sums[k] = frames [0, k)), cached by the ramp's contents:
 * ramps are edited in place inside Immer recipes, so their identity says nothing about their values.
 */
const rampTables = new Map<string, Float64Array>()
const MAX_RAMP_TABLES = 64

function rampTable(clip: VideoClip, frames: number, fps: number): Float64Array {
  const length = Math.max(frames, clip.duration) + 1
  const key = `${clip.speed}|${fps}|${length}|${JSON.stringify(clip.speedRamp)}`
  let sums = rampTables.get(key)
  if (!sums) {
    sums = new Float64Array(length + 1)
    for (let k = 0; k < length; k++) sums[k + 1] = sums[k]! + speedAt(clip, k) / fps
    if (rampTables.size >= MAX_RAMP_TABLES) rampTables.delete(rampTables.keys().next().value!)
    rampTables.set(key, sums)
  }
  return sums
}

/**
 * Source seconds used by clip-relative frames [0, frames): `frames / fps × speed`, integrated over the
 * ramp when there is one. Negative `frames` reach back before the clip (negative seconds).
 */
export function sourceOffset(clip: TimedClip, frames: number, fps: number): number {
  if (!hasRamp(clip) || clip.type !== 'video') return (frames / fps) * clip.speed
  if (frames <= 0) {
    // Before the clip (extending its head): the ramp still applies, its keyframes may lie out there.
    let seconds = 0
    const whole = Math.floor(frames)
    for (let k = whole; k < 0; k++) seconds -= speedAt(clip, k) / fps
    return seconds + ((frames - whole) * speedAt(clip, whole)) / fps
  }
  const whole = Math.floor(frames)
  const sums = rampTable(clip, whole + 1, fps)
  return sums[whole]! + ((frames - whole) * speedAt(clip, whole)) / fps
}

/** Inverse of `sourceOffset`: the clip-relative frame (fractional) at which `seconds` of source are used. */
export function framesForOffset(clip: TimedClip, seconds: number, fps: number): number {
  if (!hasRamp(clip) || clip.type !== 'video') return (seconds * fps) / clip.speed
  if (seconds <= 0) return (seconds * fps) / speedAt(clip, 0)
  const sums = rampTable(clip, clip.duration, fps)
  const last = sums.length - 1
  if (seconds >= sums[last]!) return last + ((seconds - sums[last]!) * fps) / speedAt(clip, last)
  let lo = 0
  let hi = last
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (sums[mid]! <= seconds) lo = mid
    else hi = mid
  }
  return lo + ((seconds - sums[lo]!) * fps) / speedAt(clip, lo)
}

/** Seconds of source a clip plays (0 for a frame hold). */
export const sourceSpan = (clip: TimedClip, fps: number): number =>
  isHold(clip) ? 0 : sourceOffset(clip, clip.duration, fps)

/** Source time shown (or heard) at a clip-relative frame. */
export function sourceTimeAt(clip: TimedClip, localFrame: number, fps: number): number {
  if (isHold(clip)) return clip.sourceIn
  if (clip.reversed) return clip.sourceIn + ((clip.duration - 1 - localFrame) / fps) * clip.speed
  return clip.sourceIn + sourceOffset(clip, localFrame, fps)
}

/** Unused source seconds before `sourceIn` and after the used range, in source order. */
export function sourceSlack(project: Project, clip: TimedClip): { before: number; after: number } {
  const media = findMedia(project, clip.mediaId)
  if (!media) return { before: 0, after: 0 }
  const used = isHold(clip) ? 1 / (media.fps ?? project.settings.fps) : sourceSpan(clip, project.settings.fps)
  return { before: clip.sourceIn, after: Math.max(0, media.duration - clip.sourceIn - used) }
}

/**
 * Source seconds by which a clip can grow at its start (`head`) and its end (`tail`) on the timeline.
 * A reversed clip grows at its start into later source; a frame hold can grow without limit.
 */
export function sourceHandles(project: Project, clip: Clip): { head: number; tail: number } {
  if ((clip.type !== 'video' && clip.type !== 'audio') || isHold(clip))
    return { head: Infinity, tail: Infinity }
  const { before, after } = sourceSlack(project, clip)
  return clip.reversed ? { head: after, tail: before } : { head: before, tail: after }
}

/**
 * `sourceHandles` in timeline frames: how far the start and end edges can be dragged out. The source
 * beyond an edge plays at the speed the clip has at that edge.
 */
export function handleFrames(project: Project, clip: Clip): { head: number; tail: number } {
  if (clip.type === 'compound') {
    const sequence = project.sequences?.find((s) => s.id === clip.sequenceId)
    const length = sequence ? sequenceDuration(sequence) : clip.offset + clip.duration
    return { head: clip.offset, tail: Math.max(0, length - clip.offset - clip.duration) }
  }
  const { head, tail } = sourceHandles(project, clip)
  const edge = (frame: number): number => ('sourceIn' in clip ? speedAt(clip, frame) : 1)
  const frames = (seconds: number, speed: number): number =>
    seconds === Infinity ? Infinity : Math.floor((seconds * project.settings.fps) / speed + 1e-6)
  return { head: frames(head, edge(0)), tail: frames(tail, edge(clip.duration - 1)) }
}

/** Every animatable property of a clip, for operations that must touch all of them (trim, split). */
export function animatablesOf(clip: Clip): Animatable<AnimValue>[] {
  const list: Animatable<AnimValue>[] = []
  if (isVisualClip(clip)) {
    const { position, scale, rotation, opacity } = clip.transform
    list.push(position, scale, rotation, opacity)
    for (const effect of clip.effects) list.push(...Object.values(effect.params))
  }
  if (clip.type === 'adjustment') {
    list.push(clip.opacity)
    for (const effect of clip.effects) list.push(...Object.values(effect.params))
  }
  if (isAudibleClip(clip)) list.push(clip.volume)
  if (clip.type === 'video' && clip.speedRamp) list.push(clip.speedRamp)
  return list
}
