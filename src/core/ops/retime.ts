import { evaluate } from '../keyframes/animatable'
import type { Id, Project, VideoClip } from '../model/types'
import { cloneClip, insertClip, normalizeTrack, splitClip } from './edit'
import { linkedPartners } from './link'
import { animatablesOf, clipEnd, findClip, framesForOffset, isHold, sourceTimeAt } from './query'

/** Reverse playback and frame holds. */

/** Plays a clip backwards (or forwards again), together with linked clips covering the same span. */
export function setReversed(project: Project, clipId: Id, reversed: boolean): void {
  const found = findClip(project, clipId)
  if (!found || found.track.locked) return
  const { start, duration } = found.clip
  const partners = linkedPartners(project, clipId).filter((c) => c.start === start && c.duration === duration)
  for (const clip of [found.clip, ...partners]) {
    if (!('sourceIn' in clip) || (clip.type === 'video' && clip.hold)) continue
    if (reversed) clip.reversed = true
    else delete clip.reversed
  }
}

/**
 * Inserts a frame hold of `holdFrames` at a timeline frame inside a video clip: the clip is cut there,
 * the frame under the cut is held, and everything after it on the clip's track (and on the tracks of
 * linked clips, which get a matching gap) moves right. Returns the hold clip's id.
 */
export function insertFrameHold(project: Project, clipId: Id, frame: number, holdFrames: number): Id | null {
  const found = findClip(project, clipId)
  if (!found || found.track.locked || found.clip.type !== 'video' || found.clip.hold) return null
  const clip = found.clip
  if (frame < clip.start || frame >= clipEnd(clip) || holdFrames < 1) return null
  const local = frame - clip.start
  const sourceTime = sourceTimeAt(clip, local, project.settings.fps)

  // The held frame keeps the look it has at that instant, without the animation.
  const hold = cloneClip(clip, frame) as VideoClip
  for (const anim of animatablesOf(hold)) {
    anim.value = evaluate(anim, local)
    delete anim.keyframes
  }
  Object.assign(hold, {
    name: `${clip.name} (hold)`,
    duration: holdFrames,
    sourceIn: sourceTime,
    speed: 1,
    hold: true,
    audioMuted: true,
    fadeIn: 0,
    fadeOut: 0
  })
  delete hold.reversed
  delete hold.speedRamp
  delete hold.linkId

  const tracks = new Set([found.track])
  for (const partner of linkedPartners(project, clipId)) {
    const located = findClip(project, partner.id)
    if (located && !located.track.locked && partner.start <= frame && clipEnd(partner) > frame)
      tracks.add(located.track)
  }
  if (frame > clip.start) splitClip(project, clipId, frame)
  for (const track of tracks) {
    for (const other of track.clips) if (other.start >= frame) other.start += holdFrames
    normalizeTrack(track)
  }
  insertClip(project, found.track.id, hold)
  return hold.id
}

export type SpeedRampPreset = 'none' | 'slowMiddle' | 'fastMiddle' | 'speedUp' | 'slowDown'

export const SPEED_RAMP_PRESETS: ReadonlyArray<{ value: SpeedRampPreset; label: string }> = [
  { value: 'none', label: 'No ramp' },
  { value: 'slowMiddle', label: 'Slow motion in the middle' },
  { value: 'fastMiddle', label: 'Fast forward in the middle' },
  { value: 'speedUp', label: 'Speed up' },
  { value: 'slowDown', label: 'Slow down' }
]

/** Replaces a video clip's speed ramp with a preset; its keyframes can be fine-tuned afterwards. */
export function applySpeedRamp(project: Project, clipId: Id, preset: SpeedRampPreset): void {
  const found = findClip(project, clipId)
  if (!found || found.track.locked || found.clip.type !== 'video' || found.clip.hold) return
  const clip = found.clip
  if (preset === 'none') {
    delete clip.speedRamp
    return
  }
  const last = clip.duration - 1
  const at = (fraction: number): number => Math.round(fraction * last)
  const points: Array<[number, number]> =
    preset === 'slowMiddle'
      ? [
          [0, 1],
          [0.3, 1],
          [0.42, 0.25],
          [0.58, 0.25],
          [0.7, 1],
          [1, 1]
        ]
      : preset === 'fastMiddle'
        ? [
            [0, 1],
            [0.3, 1],
            [0.42, 4],
            [0.58, 4],
            [0.7, 1],
            [1, 1]
          ]
        : preset === 'speedUp'
          ? [
              [0, 1],
              [1, 3]
            ]
          : [
              [0, 1],
              [1, 0.3]
            ]
  const keyframes = points
    .map(([fraction, value]) => ({ frame: at(fraction), value, easing: 'easeInOut' as const }))
    .filter((k, i, all) => i === 0 || k.frame > all[i - 1]!.frame)
  clip.speedRamp = { value: 1, keyframes }
  // A ramp is silent; reverse playback ignores it, so the two do not mix.
  delete clip.reversed
}

/** Reads the frame times from FFmpeg `showinfo` output (after a scene-change `select`), shifted by `offset`. */
export function parseSceneTimes(log: string, offset: number): number[] {
  return [...log.matchAll(/pts_time:\s*(-?[\d.]+)/g)].map((m) => offset + Number(m[1]))
}

/**
 * Cuts a clip (and its linked clips) wherever its source reaches one of `times` (source seconds), e.g. at
 * detected scene changes. Returns how many cuts were made.
 */
export function splitAtSourceTimes(project: Project, clipId: Id, times: readonly number[]): number {
  const found = findClip(project, clipId)
  if (!found || found.track.locked || !('sourceIn' in found.clip) || isHold(found.clip)) return 0
  const clip = found.clip
  const { fps } = project.settings
  const frames = times
    .map((t) =>
      clip.reversed
        ? clip.duration - ((t - clip.sourceIn) * fps) / clip.speed
        : framesForOffset(clip, t - clip.sourceIn, fps)
    )
    .map((f) => clip.start + Math.round(f))
    .filter((f) => f > clip.start && f < clipEnd(clip))
  // Latest first, so the original id keeps holding everything before the next cut.
  let cuts = 0
  for (const frame of [...new Set(frames)].sort((a, b) => b - a))
    if (splitClip(project, clipId, frame)) cuts++
  return cuts
}
