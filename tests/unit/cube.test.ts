import { describe, expect, it } from 'vitest'
import { applyLut, LutFormatError, parseCube } from '@core/index'

/** A 2-point identity cube, optionally with a transform applied to every entry. */
function cube(transform = (r: number, g: number, b: number) => [r, g, b], header = ''): string {
  const rows: string[] = []
  for (let b = 0; b < 2; b++)
    for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) rows.push(transform(r, g, b).join(' '))
  return `# comment\nTITLE "test"\n${header}LUT_3D_SIZE 2\n\n${rows.join('\n')}\n`
}

describe('.cube LUTs', () => {
  it('parses an identity cube and maps colours to themselves', () => {
    const lut = parseCube(cube())
    expect(lut.size).toBe(2)
    expect(lut.data.length).toBe(24)
    const [r, g, b] = applyLut(lut, [0.25, 0.5, 0.75])
    expect(r).toBeCloseTo(0.25)
    expect(g).toBeCloseTo(0.5)
    expect(b).toBeCloseTo(0.75)
  })

  it('keeps the file order: red fastest', () => {
    // Swap red and blue.
    const lut = parseCube(cube((r, g, b) => [b, g, r]))
    const [r, , b] = applyLut(lut, [1, 0, 0])
    expect([r, b]).toEqual([0, 1])
  })

  it('reads the input domain', () => {
    const lut = parseCube(cube(undefined, 'DOMAIN_MIN 0 0 0\nDOMAIN_MAX 2 2 2\n'))
    expect(applyLut(lut, [1, 1, 1])[0]).toBeCloseTo(0.5)
  })

  it('rejects broken or unsupported files', () => {
    expect(() => parseCube('LUT_1D_SIZE 4\n0 0 0')).toThrow(LutFormatError)
    expect(() => parseCube('0 0 0')).toThrow(/LUT_3D_SIZE/)
    expect(() => parseCube('LUT_3D_SIZE 2\n0 0 0\n1 1 1')).toThrow(/expected 8/)
    expect(() => parseCube('LUT_3D_SIZE 2\n0 0 x')).toThrow(/three numbers/)
  })
})
