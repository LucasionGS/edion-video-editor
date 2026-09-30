import { parseCube, type Lut3D } from '@core/index'
import type { EdionApi } from '@shared/ipc'

/** Parsed `.cube` files by path, read straight from disk like media. Failures are remembered and logged once. */
export class LutStore {
  private readonly luts = new Map<string, Lut3D | null>()
  private readonly loading = new Map<string, Promise<void>>()

  constructor(
    private readonly media: EdionApi['media'],
    private readonly onLoad?: () => void
  ) {}

  /** The LUT if it is loaded (starting the load otherwise); null while loading or when unreadable. */
  get(path: string): Lut3D | null {
    if (!this.luts.has(path)) void this.load(path)
    return this.luts.get(path) ?? null
  }

  load(path: string): Promise<void> {
    let job = this.loading.get(path)
    if (!job) {
      job = this.read(path).then(
        (lut) => {
          this.luts.set(path, lut)
          this.onLoad?.()
        },
        (error: unknown) => {
          console.warn(`[lut] cannot load ${path}`, error)
          this.luts.set(path, null)
        }
      )
      this.loading.set(path, job)
    }
    return job
  }

  private async read(path: string): Promise<Lut3D> {
    const size = await this.media.open(path)
    const bytes = await this.media.read(path, 0, size)
    return parseCube(new TextDecoder().decode(bytes))
  }
}
