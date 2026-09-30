import { describe, expect, it } from 'vitest'
import { analyzeFrame, VECTORSCOPE_SIZE, WAVEFORM_LEVELS } from '@core/index'

function frame(width: number, height: number, color: (x: number, y: number) => [number, number, number]) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) data.set([...color(x, y), 255], (y * width + x) * 4)
  return data
}

describe('scopes', () => {
  it('counts channels and luma', () => {
    const scopes = analyzeFrame(
      frame(4, 2, () => [255, 0, 0]),
      4,
      2
    )
    expect(scopes.histogram.r[255]).toBe(8)
    expect(scopes.histogram.g[0]).toBe(8)
    expect(scopes.histogram.luma[54]).toBe(8)
  })

  it('draws a black-to-white ramp as a rising waveform', () => {
    const width = 8
    const scopes = analyzeFrame(
      frame(width, 3, (x) => [x * 36, x * 36, x * 36]),
      width,
      3
    )
    const rowOf = (column: number): number => {
      for (let row = 0; row < WAVEFORM_LEVELS; row++) if (scopes.waveform[row * width + column]) return row
      return -1
    }
    expect(rowOf(0)).toBe(0)
    for (let x = 1; x < width; x++) expect(rowOf(x)).toBeGreaterThan(rowOf(x - 1))
  })

  it('puts grey in the middle of the vectorscope and colours around it', () => {
    const half = VECTORSCOPE_SIZE / 2
    const grey = analyzeFrame(
      frame(2, 2, () => [128, 128, 128]),
      2,
      2
    )
    expect(grey.vectorscope[half * VECTORSCOPE_SIZE + half]).toBe(4)
    const red = analyzeFrame(
      frame(1, 1, () => [255, 0, 0]),
      1,
      1
    )
    const index = red.vectorscope.findIndex((v) => v > 0)
    const [u, v] = [index % VECTORSCOPE_SIZE, Math.floor(index / VECTORSCOPE_SIZE)]
    // Red: strongly positive Cr, slightly negative Cb.
    expect(v).toBeGreaterThan(half + 30)
    expect(u).toBeLessThan(half)
  })
})
