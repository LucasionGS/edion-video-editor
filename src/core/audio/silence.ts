import type { Id, Project } from '../model/types'
import { deleteClips, splitClip } from '../ops/edit'
import { withLinked } from '../ops/link'
import { evaluate } from '../keyframes/animatable'
import { isAudibleClip } from '../model/types'
import { clipEnd, findClip, framesForOffset, isHold, type TimedClip } from '../ops/query'

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
  const merged = sourceRangesToLocal(clip, ranges, project.settings.fps)

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

/**
 * Source-second ranges of a clip's media as clip-relative frame spans, clamped to the clip, sorted and
 * merged. A reversed clip runs its source backwards.
 */
export function sourceRangesToLocal(
  clip: TimedClip,
  ranges: ReadonlyArray<readonly [number, number]>,
  fps: number
): Array<[number, number]> {
  const local = (seconds: number): number => {
    if (clip.reversed) return clip.duration - ((seconds - clip.sourceIn) * fps) / clip.speed
    return framesForOffset(clip, seconds - clip.sourceIn, fps)
  }
  const spans = ranges
    .map(([a, b]) => {
      const [x, y] = [local(a), local(b)].sort((p, q) => p - q) as [number, number]
      return [Math.max(0, Math.round(x)), Math.min(clip.duration, Math.round(y))] as [number, number]
    })
    .filter(([from, to]) => to - from >= 1)
    .sort((p, q) => p[0] - q[0])
  return mergeSpans(spans)
}

/** Sorted spans with overlapping (or touching within `gap`) ones joined. */
export function mergeSpans(
  spans: ReadonlyArray<readonly [number, number]>,
  gap = 0
): Array<[number, number]> {
  const merged: Array<[number, number]> = []
  for (const span of [...spans].sort((p, q) => p[0] - q[0])) {
    const last = merged[merged.length - 1]
    if (last && span[0] <= last[1] + gap) last[1] = Math.max(last[1], span[1])
    else merged.push([span[0], span[1]])
  }
  return merged
}

/** The parts of [from, to] that are not silent. */
export function invertRanges(
  silences: ReadonlyArray<readonly [number, number]>,
  from: number,
  to: number
): Array<[number, number]> {
  const sound: Array<[number, number]> = []
  let cursor = from
  for (const [a, b] of mergeSpans(silences)) {
    if (a > cursor) sound.push([cursor, Math.min(a, to)])
    cursor = Math.max(cursor, b)
  }
  if (cursor < to) sound.push([cursor, to])
  return sound.filter(([a, b]) => b > a)
}

export interface DuckOptions {
  /** How far the music drops while someone speaks, in dB (negative). */
  depthDb: number
  /** Ramp length down and back up, in seconds. */
  fadeSeconds: number
}

export const DEFAULT_DUCK_OPTIONS: DuckOptions = { depthDb: -12, fadeSeconds: 0.3 }

/**
 * Writes volume keyframes on a clip so it dips by `depthDb` during `speech` (timeline frame spans). Pauses
 * shorter than the two ramps stay ducked instead of pumping. Replaces any volume animation the clip had.
 */
export function duckClip(
  project: Project,
  clipId: Id,
  speech: ReadonlyArray<readonly [number, number]>,
  options: DuckOptions = DEFAULT_DUCK_OPTIONS
): number {
  const found = findClip(project, clipId)
  if (!found || found.track.locked || !isAudibleClip(found.clip)) return 0
  const clip = found.clip
  const fade = Math.max(1, Math.round(options.fadeSeconds * project.settings.fps))
  const level = evaluate(clip.volume, 0)
  const low = level * 10 ** (options.depthDb / 20)
  const spans = mergeSpans(
    speech
      .map(([a, b]) => [a - clip.start, b - clip.start] as [number, number])
      .filter(([a, b]) => b > 0 && a < clip.duration),
    fade * 2
  )
  const keyframes: Array<{ frame: number; value: number }> = []
  const add = (frame: number, value: number): void => {
    const f = Math.max(0, Math.min(clip.duration, Math.round(frame)))
    const last = keyframes[keyframes.length - 1]
    if (last && f <= last.frame) {
      last.value = value
      return
    }
    keyframes.push({ frame: f, value })
  }
  for (const [a, b] of spans) {
    add(a - fade, level)
    add(a, low)
    add(b, low)
    add(b + fade, level)
  }
  if (keyframes.length === 0) return 0
  clip.volume = { value: level, keyframes: keyframes.map((k) => ({ ...k, easing: 'linear' as const })) }
  return spans.length
}
