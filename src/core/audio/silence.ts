import type { Id, Project } from '../model/types'
import { deleteClips, splitClip } from '../ops/edit'
import { withLinked } from '../ops/link'
import { clipEnd, findClip, isHold } from '../ops/query'

/** "Remove silence": find the quiet parts of a clip's sound and cut them out (jump cuts). */

export interface SilenceOptions {
  /** Anything quieter than this (dBFS) counts as silence. */
  thresholdDb: number
  /** Only pauses at least this long (seconds) are removed. */
  minSeconds: number
  /** Seconds of each pause kept before and after the speech, so cuts don't clip words. */
  paddingSeconds: number
}

export const DEFAULT_SILENCE_OPTIONS: SilenceOptions = {
  thresholdDb: -38,
  minSeconds: 0.6,
  paddingSeconds: 0.12
}

/**
 * Reads FFmpeg `silencedetect` output into [start, end] ranges in seconds, shifted by `offset` (the `-ss`
 * the measurement started at). A silence still open at the end runs to `offset + duration`.
 */
export function parseSilences(log: string, offset: number, duration: number): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  let open: number | null = null
  for (const match of log.matchAll(/silence_(start|end):\s*(-?[\d.]+)/g)) {
    const time = Math.max(0, Number(match[2]))
    if (match[1] === 'start') open = time
    else if (open !== null) {
      ranges.push([offset + open, offset + time])
      open = null
    }
  }
  if (open !== null && open < duration) ranges.push([offset + open, offset + duration])
  return ranges
}

/**
 * Cuts source-time ranges out of a clip (and its linked clips), closing each gap: the rest of the track
 * moves left. `ranges` are in source seconds, as measured on the clip's media; padding is already applied
 * by the caller. Returns the number of timeline frames removed.
 */
export function removeSourceRanges(
  project: Project,
  clipId: Id,
  ranges: ReadonlyArray<readonly [number, number]>,
  linked = true
): number {
  const found = findClip(project, clipId)
  if (!found || found.track.locked || !('sourceIn' in found.clip) || isHold(found.clip)) return 0
  const clip = found.clip
  const { fps } = project.settings
  // Source seconds → clip-relative frames (a reversed clip runs its source backwards).
  const local = (seconds: number): number => {
    const frames = ((seconds - clip.sourceIn) * fps) / clip.speed
    return clip.reversed ? clip.duration - frames : frames
  }
  const spans = ranges
    .map(([a, b]) => {
      const [x, y] = [local(a), local(b)].sort((p, q) => p - q) as [number, number]
      return [Math.max(0, Math.round(x)), Math.min(clip.duration, Math.round(y))] as [number, number]
    })
    .filter(([from, to]) => to - from >= 1)
    .sort((p, q) => p[0] - q[0])
  // Merge overlaps so each frame is removed once.
  const merged: Array<[number, number]> = []
  for (const span of spans) {
    const last = merged[merged.length - 1]
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1])
    else merged.push([...span])
  }

  const origin = clip.start
  let removed = 0
  // From the end backwards: the original id always holds the part before the current span.
  for (const [from, to] of merged.reverse()) {
    const current = findClip(project, clipId)?.clip
    if (!current) break
    const start = origin + from
    const end = origin + to
    if (end < clipEnd(current)) splitClip(project, clipId, end, linked)
    const middle = start > current.start ? splitClip(project, clipId, start, linked) : clipId
    if (!middle) continue
    deleteClips(project, linked ? withLinked(project, [middle]) : [middle], true)
    removed += to - from
  }
  return removed
}

/** Shrinks each silence by the padding on both sides, dropping those that become too short. */
export function padSilences(
  ranges: ReadonlyArray<readonly [number, number]>,
  paddingSeconds: number
): Array<[number, number]> {
  return ranges
    .map(([a, b]) => [a + paddingSeconds, b - paddingSeconds] as [number, number])
    .filter(([a, b]) => b - a > 0.01)
}
