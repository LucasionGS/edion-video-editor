import type { EdionApi } from '@shared/ipc'

/** Decoded stills, keyed by file path. */
export class ImageStore {
  private readonly bitmaps = new Map<string, ImageBitmap>()
  private readonly loading = new Map<string, Promise<void>>()

  constructor(
    private readonly library: Pick<EdionApi['library'], 'fileUrl'>,
    private readonly onLoad?: () => void
  ) {}

  get(path: string): ImageBitmap | null {
    const bitmap = this.bitmaps.get(path)
    if (!bitmap) void this.load(path)
    return bitmap ?? null
  }

  load(path: string): Promise<void> {
    let job = this.loading.get(path)
    if (!job) {
      job = (async () => {
        const image = new Image()
        image.src = await this.library.fileUrl(path)
        await image.decode()
        // SVGs may have no intrinsic size; give them a sensible one.
        const width = image.naturalWidth || 1024
        const height = image.naturalHeight || 1024
        this.bitmaps.set(path, await createImageBitmap(image, { resizeWidth: width, resizeHeight: height }))
        this.onLoad?.()
      })().catch((error) => console.warn(`[image] cannot load ${path}`, error))
      this.loading.set(path, job)
    }
    return job
  }
}
