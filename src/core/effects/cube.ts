/** Parser for Adobe / Resolve `.cube` 3D colour lookup tables. */

export interface Lut3D {
  /** Points per axis. */
  size: number
  domainMin: [number, number, number]
  domainMax: [number, number, number]
  /** size³ RGB triplets, red changing fastest, then green, then blue (the file order). */
  data: Float32Array
}

export class LutFormatError extends Error {}

const MAX_SIZE = 256

export function parseCube(text: string): Lut3D {
  let size = 0
  let domainMin: [number, number, number] = [0, 0, 0]
  let domainMax: [number, number, number] = [1, 1, 1]
  let data: Float32Array | null = null
  let count = 0
  const triple = (parts: string[], line: number): [number, number, number] => {
    const values = parts.slice(0, 3).map(Number)
    if (values.length !== 3 || values.some((v) => !Number.isFinite(v)))
      throw new LutFormatError(`Line ${line}: expected three numbers.`)
    return values as [number, number, number]
  }

  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim()
    if (line === '' || line.startsWith('#')) continue
    const parts = line.split(/\s+/)
    const keyword = parts[0]!.toUpperCase()
    if (keyword === 'TITLE') continue
    if (keyword === 'LUT_1D_SIZE') throw new LutFormatError('1D LUTs are not supported; use a 3D .cube file.')
    if (keyword === 'LUT_3D_SIZE') {
      size = Number(parts[1])
      if (!Number.isInteger(size) || size < 2 || size > MAX_SIZE)
        throw new LutFormatError(`Unsupported LUT size ${parts[1]}.`)
      data = new Float32Array(size * size * size * 3)
      continue
    }
    if (keyword === 'DOMAIN_MIN') {
      domainMin = triple(parts.slice(1), i + 1)
      continue
    }
    if (keyword === 'DOMAIN_MAX') {
      domainMax = triple(parts.slice(1), i + 1)
      continue
    }
    if (/^[A-Z_]+$/.test(keyword)) continue // Other metadata (LUT_3D_INPUT_RANGE, …).
    if (!data) throw new LutFormatError('LUT_3D_SIZE must come before the table.')
    if (count >= size * size * size) throw new LutFormatError('The table has more entries than LUT_3D_SIZE.')
    data.set(triple(parts, i + 1), count * 3)
    count++
  }
  if (!data) throw new LutFormatError('Not a 3D .cube file (LUT_3D_SIZE is missing).')
  if (count !== size * size * size)
    throw new LutFormatError(`The table has ${count} entries; expected ${size * size * size}.`)
  return { size, domainMin, domainMax, data }
}

/** Looks up a colour with trilinear interpolation; the reference the GPU shader is tested against. */
export function applyLut(lut: Lut3D, rgb: [number, number, number]): [number, number, number] {
  const n = lut.size - 1
  const coords = rgb.map((v, i) => {
    const t = (v - lut.domainMin[i]!) / (lut.domainMax[i]! - lut.domainMin[i]! || 1)
    return Math.max(0, Math.min(1, t)) * n
  }) as [number, number, number]
  const base = coords.map((c) => Math.min(Math.floor(c), n - 1)) as [number, number, number]
  const f = coords.map((c, i) => c - base[i]!)
  const at = (r: number, g: number, b: number, channel: number): number =>
    lut.data[((b * lut.size + g) * lut.size + r) * 3 + channel]!
  const out: [number, number, number] = [0, 0, 0]
  for (let channel = 0; channel < 3; channel++) {
    let value = 0
    for (let corner = 0; corner < 8; corner++) {
      const dr = corner & 1
      const dg = (corner >> 1) & 1
      const db = (corner >> 2) & 1
      const weight = (dr ? f[0]! : 1 - f[0]!) * (dg ? f[1]! : 1 - f[1]!) * (db ? f[2]! : 1 - f[2]!)
      value += weight * at(base[0] + dr, base[1] + dg, base[2] + db, channel)
    }
    out[channel] = value
  }
  return out
}
