/** Video scopes computed from an RGBA frame (usually a downscaled copy of the preview). Pure pixel maths. */

export const WAVEFORM_LEVELS = 128
export const VECTORSCOPE_SIZE = 128

export interface ScopeData {
  width: number
  /** Counts per value 0-255, per channel and for luma (BT.709). */
  histogram: { r: Uint32Array; g: Uint32Array; b: Uint32Array; luma: Uint32Array }
  /** `width` columns × WAVEFORM_LEVELS rows of luma counts; row 0 is black. */
  waveform: Uint32Array
  /** VECTORSCOPE_SIZE² counts of (Cb, Cr); the centre is neutral grey. Row 0 is Cr = -0.5. */
  vectorscope: Uint32Array
}

export function analyzeFrame(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): ScopeData {
  const histogram = {
    r: new Uint32Array(256),
    g: new Uint32Array(256),
    b: new Uint32Array(256),
    luma: new Uint32Array(256)
  }
  const waveform = new Uint32Array(width * WAVEFORM_LEVELS)
  const vectorscope = new Uint32Array(VECTORSCOPE_SIZE * VECTORSCOPE_SIZE)
  const half = VECTORSCOPE_SIZE / 2
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const r = rgba[i]!
      const g = rgba[i + 1]!
      const b = rgba[i + 2]!
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
      histogram.r[r]!++
      histogram.g[g]!++
      histogram.b[b]!++
      histogram.luma[Math.round(luma)]!++
      waveform[Math.min(WAVEFORM_LEVELS - 1, Math.floor((luma / 256) * WAVEFORM_LEVELS)) * width + x]!++
      // BT.709 colour difference, each in -0.5 … 0.5.
      const cb = (b - luma) / 255 / 1.8556
      const cr = (r - luma) / 255 / 1.5748
      const u = Math.min(VECTORSCOPE_SIZE - 1, Math.max(0, Math.floor(half + cb * VECTORSCOPE_SIZE)))
      const v = Math.min(VECTORSCOPE_SIZE - 1, Math.max(0, Math.floor(half + cr * VECTORSCOPE_SIZE)))
      vectorscope[v * VECTORSCOPE_SIZE + u]!++
    }
  }
  return { width, histogram, waveform, vectorscope }
}
