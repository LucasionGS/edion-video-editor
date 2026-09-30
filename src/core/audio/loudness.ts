import type { Id, Project } from '../model/types'
import { isAudibleClip } from '../model/types'
import { findClip } from '../ops/query'

/** Loudness normalisation: measured by FFmpeg's EBU R128 filter, applied as clip volume. */

export interface Loudness {
  /** Integrated loudness in LUFS (-Infinity for silence). */
  integrated: number
  /** True peak in dBFS. */
  peak: number
}

/** Streaming platforms normalise to about -14 LUFS, so that is what "Normalize" aims for. */
export const LOUDNESS_TARGET = -14
/** Never let the true peak go above this, even if the loudness target would. */
export const PEAK_CEILING = -1
/** Clip volume is capped at 400 %. */
const MAX_GAIN = 4

/** Reads the summary FFmpeg's `ebur128=peak=true` filter prints at the end of a run. */
export function parseEbur128(log: string): Loudness | null {
  const summary = log.slice(log.lastIndexOf('Summary:'))
  const integrated = summary.match(/I:\s*(-?[\d.]+|-inf)\s*LUFS/)
  const peak = summary.match(/Peak:\s*(-?[\d.]+|-inf)\s*dBFS/)
  if (!integrated || !peak) return null
  const value = (text: string): number => (text === '-inf' ? -Infinity : Number(text))
  return { integrated: value(integrated[1]!), peak: value(peak[1]!) }
}

/** Linear gain that brings a clip to the target loudness without its peaks exceeding the ceiling. */
export function normalizationGain(
  measured: Loudness,
  target = LOUDNESS_TARGET,
  ceiling = PEAK_CEILING
): number {
  // EBU R128 gates out silence entirely; below -70 LUFS there is nothing meaningful to normalise.
  if (!Number.isFinite(measured.integrated) || measured.integrated < -70) return 1
  const db = Math.min(target - measured.integrated, ceiling - measured.peak)
  return Math.min(MAX_GAIN, 10 ** (db / 20))
}

/**
 * Sets a clip's volume to `gain`. Keyframed volume keeps its shape: the loudest keyframe becomes `gain`
 * and the others scale with it.
 */
export function applyGain(project: Project, clipId: Id, gain: number): void {
  const found = findClip(project, clipId)
  if (!found || found.track.locked || !isAudibleClip(found.clip)) return
  const volume = found.clip.volume
  if (!volume.keyframes?.length) {
    volume.value = gain
    return
  }
  const loudest = Math.max(...volume.keyframes.map((k) => k.value))
  const factor = loudest > 0 ? gain / loudest : 0
  for (const k of volume.keyframes) k.value = Math.min(MAX_GAIN, k.value * factor)
}
