import type { Animatable, AnimValue, Clip, Id, MediaAsset, Project, Track } from '../model/types'
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

/** Length of the timeline in frames (end of the last clip). */
export function projectDuration(project: Project): number {
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

/** Source media seconds still available before the clip's in point and after its out point. */
export function sourceHandles(project: Project, clip: Clip): { head: number; tail: number } {
  if (clip.type !== 'video' && clip.type !== 'audio') return { head: Infinity, tail: Infinity }
  const media = findMedia(project, clip.mediaId)
  if (!media) return { head: 0, tail: 0 }
  const used = (clip.duration / project.settings.fps) * clip.speed
  return { head: clip.sourceIn, tail: Math.max(0, media.duration - clip.sourceIn - used) }
}

/** Every animatable property of a clip, for operations that must touch all of them (trim, split). */
export function animatablesOf(clip: Clip): Animatable<AnimValue>[] {
  const list: Animatable<AnimValue>[] = []
  if (isVisualClip(clip)) {
    const { position, scale, rotation, opacity } = clip.transform
    list.push(position, scale, rotation, opacity)
    for (const effect of clip.effects) list.push(...Object.values(effect.params))
  }
  if (isAudibleClip(clip)) list.push(clip.volume)
  return list
}
