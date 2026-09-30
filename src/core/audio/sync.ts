import type { Id, Project } from '../model/types'
import { moveClips } from '../ops/edit'
import { withLinked } from '../ops/link'
import { findClip } from '../ops/query'

/**
 * Synchronising clips by their sound (a camera and a separate recorder, or several cameras): the loudness
 * envelopes of the two files are cross-correlated, and the best match gives the time offset between them.
 */

/** In-place radix-2 FFT of (re, im); `inverse` for the inverse transform (unscaled). */
function fft(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j]!, re[i]!]
      ;[im[i], im[j]] = [im[j]!, im[i]!]
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const angle = ((inverse ? 2 : -2) * Math.PI) / size
    const wr = Math.cos(angle)
    const wi = Math.sin(angle)
    for (let start = 0; start < n; start += size) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < size / 2; k++) {
        const a = start + k
        const b = a + size / 2
        const tr = re[b]! * cr - im[b]! * ci
        const ti = re[b]! * ci + im[b]! * cr
        re[b] = re[a]! - tr
        im[b] = im[a]! - ti
        re[a] = re[a]! + tr
        im[a] = im[a]! + ti
        const next = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = next
      }
    }
  }
}

/** Loudness changes rather than loudness: subtracting a moving average keeps the onsets that line up. */
function onsets(envelope: ArrayLike<number>, window: number): Float64Array {
  const out = new Float64Array(envelope.length)
  let sum = 0
  for (let i = 0; i < envelope.length; i++) {
    sum += envelope[i]!
    if (i >= window) sum -= envelope[i - window]!
    out[i] = envelope[i]! - sum / Math.min(i + 1, window)
  }
  return out
}

/**
 * The time offset between two recordings of the same sound: a moment at time `t` in `other` happens at
 * `t + seconds` in `reference`. `confidence` is the normalised correlation (about 0.3 and up is a real match).
 */
export function audioOffset(
  reference: ArrayLike<number>,
  other: ArrayLike<number>,
  perSecond: number
): { seconds: number; confidence: number } {
  const a = onsets(reference, perSecond / 2)
  const b = onsets(other, perSecond / 2)
  let size = 1
  while (size < a.length + b.length) size <<= 1
  const ar = new Float64Array(size)
  const ai = new Float64Array(size)
  const br = new Float64Array(size)
  const bi = new Float64Array(size)
  ar.set(a)
  br.set(b)
  fft(ar, ai, false)
  fft(br, bi, false)
  // A · conj(B): the cross-correlation of a with b, lag k meaning a[i + k] ~ b[i].
  for (let i = 0; i < size; i++) {
    const r = ar[i]! * br[i]! + ai[i]! * bi[i]!
    const im = ai[i]! * br[i]! - ar[i]! * bi[i]!
    ar[i] = r
    ai[i] = im
  }
  fft(ar, ai, true)
  let best = 0
  let bestLag = 0
  for (let i = 0; i < size; i++) {
    const lag = i < size / 2 ? i : i - size
    if (lag > a.length || -lag > b.length) continue
    if (ar[i]! > best) {
      best = ar[i]!
      bestLag = lag
    }
  }
  const norm = Math.sqrt(a.reduce((s, v) => s + v * v, 0) * b.reduce((s, v) => s + v * v, 0))
  return { seconds: bestLag / perSecond, confidence: norm > 0 ? best / size / norm : 0 }
}

/**
 * Moves `clipId` (with its linked clips) so that it plays in sync with `referenceId`, given the offset of
 * its media against the reference's (see `audioOffset`). Returns false when it cannot go there.
 */
export function syncClip(project: Project, referenceId: Id, clipId: Id, offsetSeconds: number): boolean {
  const reference = findClip(project, referenceId)?.clip
  const found = findClip(project, clipId)
  if (!reference || !found || !('sourceIn' in reference) || !('sourceIn' in found.clip)) return false
  const { fps } = project.settings
  const clip = found.clip
  // Source time s in the clip is s + offset in the reference, which the reference shows at
  // reference.start + (s + offset - reference.sourceIn) · fps.
  const start = Math.round(reference.start + (offsetSeconds - reference.sourceIn + clip.sourceIn) * fps)
  const delta = start - clip.start
  if (delta === 0) return true
  const moves = withLinked(project, [clipId]).flatMap((id) => {
    const located = findClip(project, id)
    return located ? [{ clipId: id, trackId: located.track.id, start: located.clip.start + delta }] : []
  })
  return moveClips(project, moves)
}
