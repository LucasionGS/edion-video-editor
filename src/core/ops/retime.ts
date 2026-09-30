import { evaluate } from '../keyframes/animatable'
import type { Id, Project, VideoClip } from '../model/types'
import { cloneClip, insertClip, normalizeTrack, splitClip } from './edit'
import { linkedPartners } from './link'
import { animatablesOf, clipEnd, findClip, sourceTimeAt } from './query'

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
