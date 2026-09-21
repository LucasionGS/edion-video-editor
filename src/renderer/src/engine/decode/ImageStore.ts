import type { EdionApi } from '@shared/ipc'

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  avif: 'image/avif'
}

/**
 * Decoded stills, keyed by file path. The bytes are read straight from disk and decoded from a
 * same-origin blob: an image loaded from the app's custom file protocol counts as cross-origin,
 * and WebGL refuses to upload cross-origin pixels.
 */
export class ImageStore {
  private readonly bitmaps = new Map<string, ImageBitmap>()
  private readonly loading = new Map<string, Promise<void>>()

  constructor(
    private readonly media: EdionApi['media'],
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
      job = this.decode(path).then(
        (bitmap) => {
          this.bitmaps.set(path, bitmap)
          this.onLoad?.()
        },
        (error) => console.warn(`[image] cannot load ${path}`, error)
      )
      this.loading.set(path, job)
    }
    return job
  }

  private async decode(path: string): Promise<ImageBitmap> {
    const size = await this.media.open(path)
    const bytes = await this.media.read(path, 0, size)
    const type = MIME[path.split('.').pop()?.toLowerCase() ?? ''] ?? ''
    const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type })
    // An <img> handles everything Chromium can show, including SVG, and honours EXIF orientation.
    const url = URL.createObjectURL(blob)
    try {
      const image = new Image()
      image.src = url
      await image.decode()
      // SVGs may have no intrinsic size; give them a sensible one.
      const width = image.naturalWidth || 1024
      const height = image.naturalHeight || 1024
      return await createImageBitmap(image, { resizeWidth: width, resizeHeight: height })
    } finally {
      URL.revokeObjectURL(url)
    }
  }
}
