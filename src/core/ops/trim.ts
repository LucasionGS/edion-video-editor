import type { Clip, Id, Project, Track } from '../model/types'
import { clampFades, cutHead, cutTail, normalizeTrack } from './edit'
import { linkedPartners } from './link'
import { clipEnd, findClip, findTrack, isHold, sourceHandles, sourceSlack } from './query'

/**
 * The editing tools beyond plain trimming: ripple, roll, slip and slide, plus closing gaps.
 * Like the other ops they mutate an Immer draft, keep every track valid, and take linked clips along
 * when `linked` is set (only partners whose edges line up with the edited clip).
 */

const EPSILON = 1e-6

/** Source media still available before and after the clip, in timeline frames. */
function handleFrames(project: Project, clip: Clip): { head: number; tail: number } {
  const { head, tail } = sourceHandles(project, clip)
  const speed = 'speed' in clip ? clip.speed : 1
  const frames = (seconds: number): number =>
    seconds === Infinity ? Infinity : Math.floor((seconds * project.settings.fps) / speed + EPSILON)
  return { head: frames(head), tail: frames(tail) }
}

interface Located {
  clip: Clip
  track: Track
  index: number
}

/** The clip plus the unlocked linked partners for which `same` holds. */
function groupOf(
  project: Project,
  clipId: Id,
  linked: boolean,
  same: (partner: Clip, clip: Clip) => boolean
): Located[] | null {
  const found = findClip(project, clipId)
  if (!found || found.track.locked) return null
  const group: Located[] = [found]
  if (!linked) return group
  for (const partner of linkedPartners(project, clipId)) {
    const located = findClip(project, partner.id)
    if (located && !located.track.locked && same(partner, found.clip)) group.push(located)
  }
  return group
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(value, max))

// ── Ripple trim ───────────────────────────────────────────────────────────────────────────────────

/**
 * Trims an edge and moves everything after the clip on its track by the same amount, so no gap opens
 * and nothing is overwritten. A trimmed start edge stays where it is: the content slides under it.
 * Returns the frame where the edited edge ends up.
 */
export function rippleTrim(
  project: Project,
  clipId: Id,
  edge: 'start' | 'end',
  frame: number,
  linked = true
): number | null {
  const edgeOf = (clip: Clip): number => (edge === 'start' ? clip.start : clipEnd(clip))
  const group = groupOf(project, clipId, linked, (p, c) => edgeOf(p) === edgeOf(c))
  if (!group) return null
  const origin = edgeOf(group[0]!.clip)
  let min = -Infinity
  let max = Infinity
  for (const { clip } of group) {
    const handles = handleFrames(project, clip)
    if (edge === 'end') {
      min = Math.max(min, 1 - clip.duration)
      max = Math.min(max, handles.tail)
    } else {
      min = Math.max(min, -handles.head)
      max = Math.min(max, clip.duration - 1)
    }
  }
  const delta = clamp(frame - origin, min, max)
  if (delta === 0) return origin
  const shift = edge === 'end' ? delta : -delta
  for (const { clip, track } of group) {
    const end = clipEnd(clip)
    for (const other of track.clips) if (other !== clip && other.start >= end) other.start += shift
    if (edge === 'end') cutTail(project, clip, -delta)
    else cutHead(project, clip, delta)
    clampFades(clip)
    normalizeTrack(track)
  }
  return edge === 'end' ? origin + delta : origin
}

// ── Roll ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * Moves the cut between a clip and the clip right after it: one gets longer, the other shorter, and
 * nothing else on the timeline moves. `clipId` is the clip on the left of the cut. Returns the new cut.
 */
export function rollEdit(project: Project, clipId: Id, frame: number, linked = true): number | null {
  const group = groupOf(project, clipId, linked, (p, c) => clipEnd(p) === clipEnd(c))
  if (!group) return null
  const pairs = group.flatMap(({ clip, track, index }) => {
    const right = track.clips[index + 1]
    return right && right.start === clipEnd(clip) ? [{ left: clip, right, track }] : []
  })
  if (pairs[0]?.left.id !== clipId) return null
  const cut = clipEnd(pairs[0].left)
  let min = -Infinity
  let max = Infinity
  for (const { left, right } of pairs) {
    min = Math.max(min, 1 - left.duration, -handleFrames(project, right).head)
    max = Math.min(max, right.duration - 1, handleFrames(project, left).tail)
  }
  const delta = clamp(frame - cut, min, max)
  if (delta === 0) return cut
  for (const { left, right, track } of pairs) {
    cutTail(project, left, -delta)
    cutHead(project, right, delta)
    right.start += delta
    clampFades(left)
    clampFades(right)
    normalizeTrack(track)
  }
  return cut + delta
}

// ── Slip ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * Shows a different part of the source without moving or resizing the clip: positive `delta` frames
 * use later source (for a frame hold: hold a later frame). Returns the delta actually applied (limited by the source length).
 */
export function slipClip(project: Project, clipId: Id, delta: number, linked = true): number {
  const group = groupOf(
    project,
    clipId,
    linked,
    (p, c) => p.start === c.start && p.duration === c.duration
  )?.filter(({ clip }) => 'sourceIn' in clip)
  if (!group || group.length === 0 || group[0]!.clip.id !== clipId) return 0
  const { fps } = project.settings
  let min = -Infinity
  let max = Infinity
  for (const { clip } of group) {
    if (!('sourceIn' in clip)) continue
    const { before, after } = sourceSlack(project, clip)
    const speed = isHold(clip) ? 1 : clip.speed
    min = Math.max(min, -Math.floor((before * fps) / speed + EPSILON))
    max = Math.min(max, Math.floor((after * fps) / speed + EPSILON))
  }
  const applied = clamp(delta, min, max)
  if (applied === 0) return 0
  for (const { clip } of group) {
    if ('sourceIn' in clip)
      clip.sourceIn = Math.max(0, clip.sourceIn + (applied / fps) * (isHold(clip) ? 1 : clip.speed))
  }
  return applied
}

// ── Slide ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Moves a clip along its track while the neighbours it touches give or take the difference: the clip
 * before gets longer or shorter at its end, the clip after at its start. The clip's own content and
 * the overall length stay the same. Returns the delta actually applied.
 */
export function slideClip(project: Project, clipId: Id, delta: number, linked = true): number {
  const group = groupOf(project, clipId, linked, (p, c) => p.start === c.start && p.duration === c.duration)
  if (!group) return 0
  const plans = group.map(({ clip, track, index }) => {
    const previous = track.clips[index - 1]
    const next = track.clips[index + 1]
    return {
      clip,
      track,
      previous: previous && clipEnd(previous) === clip.start ? previous : null,
      next: next && next.start === clipEnd(clip) ? next : null,
      gapBefore: clip.start - (previous ? clipEnd(previous) : 0),
      gapAfter: next ? next.start - clipEnd(clip) : Infinity
    }
  })
  let min = -Infinity
  let max = Infinity
  for (const plan of plans) {
    if (plan.previous) {
      min = Math.max(min, 1 - plan.previous.duration)
      max = Math.min(max, handleFrames(project, plan.previous).tail)
    } else min = Math.max(min, -plan.gapBefore)
    if (plan.next) {
      max = Math.min(max, plan.next.duration - 1)
      min = Math.max(min, -handleFrames(project, plan.next).head)
    } else max = Math.min(max, plan.gapAfter)
  }
  const applied = clamp(delta, min, max)
  if (applied === 0) return 0
  for (const { clip, track, previous, next } of plans) {
    clip.start += applied
    if (previous) {
      cutTail(project, previous, -applied)
      clampFades(previous)
    }
    if (next) {
      cutHead(project, next, applied)
      next.start += applied
      clampFades(next)
    }
    normalizeTrack(track)
  }
  return applied
}

// ── Gaps ──────────────────────────────────────────────────────────────────────────────────────────

/** The empty span on a track containing `frame`, or null when a clip is there or nothing follows. */
export function gapAt(track: Track, frame: number): { start: number; end: number } | null {
  let start = 0
  for (const clip of track.clips) {
    if (frame < clip.start) return clip.start > start ? { start, end: clip.start } : null
    if (frame < clipEnd(clip)) return null
    start = clipEnd(clip)
  }
  return null
}

/** Removes the gap at `frame` by pulling the later clips on the track to the left. Returns its length. */
export function closeGap(project: Project, trackId: Id, frame: number): number {
  const track = findTrack(project, trackId)
  const gap = track && !track.locked ? gapAt(track, frame) : null
  if (!track || !gap) return 0
  const length = gap.end - gap.start
  for (const clip of track.clips) if (clip.start >= gap.end) clip.start -= length
  normalizeTrack(track)
  return length
}

/** Removes every gap on a track (including the one before the first clip). */
export function closeAllGaps(project: Project, trackId: Id): void {
  const track = findTrack(project, trackId)
  if (!track || track.locked) return
  let cursor = 0
  for (const clip of track.clips) {
    clip.start = cursor
    cursor = clipEnd(clip)
  }
  normalizeTrack(track)
}
