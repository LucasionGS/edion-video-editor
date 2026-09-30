import { findMedia } from '@core/index'
import type { Project, VisualClip } from '@core/index'
import { rasterizeText } from './compositor/raster'

const textSizes = new Map<string, [number, number]>()

/** Size in project pixels of what a clip draws at scale 1 — the same rules the compositor applies. */
export function naturalSize(project: Project, clip: VisualClip): [number, number] {
  const { width, height } = project.settings
  if (clip.type === 'shape') return [clip.size[0] + clip.strokeWidth, clip.size[1] + clip.strokeWidth]
  // A compound clip draws its sequence at the project's size.
  if (clip.type === 'compound') return [width, height]
  if (clip.type === 'text') {
    const key = `${clip.boxWidth}:${clip.text}:${JSON.stringify(clip.style)}`
    let size = textSizes.get(key)
    if (!size) {
      const raster = rasterizeText(clip.text, clip.style, clip.boxWidth, 0.05)
      size = [raster.width, raster.height]
      if (textSizes.size > 200) textSizes.clear()
      textSizes.set(key, size)
    }
    return size
  }
  const media = findMedia(project, clip.mediaId)
  const w = media?.width || width
  const h = media?.height || height
  const fit = Math.min(width / w, height / h)
  return [w * fit, h * fit]
}
