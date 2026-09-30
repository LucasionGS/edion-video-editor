import '@fontsource-variable/inter'
import { fpsToRational, parseProject, projectDuration } from '@core/index'
import { exportFormat } from '@shared/formats'
import type { ResolvedEncoder } from '@shared/ipc'
import { mixdown } from './engine/export/mixdown'
import { SceneRenderer } from './engine/SceneRenderer'

/**
 * The export worker. Runs in a hidden window so the editor stays responsive:
 * audio mixdown → (scene → compositor → raw RGBA → FFmpeg) per frame, with the same
 * SceneRenderer the preview uses.
 */
const api = window.edionExport
let aborted = false

class Aborted extends Error {}

async function run(): Promise<void> {
  api.onAbort(() => (aborted = true))
  const { request, encoders } = await api.getJob()
  const project = parseProject(request.projectJson)
  const { settings } = request
  const format = exportFormat(settings.format)
  const still = format.still ? Math.max(0, settings.frame ?? 0) : null
  const from = still ?? Math.max(0, settings.range?.in ?? 0)
  const to = still !== null ? still + 1 : Math.min(projectDuration(project), settings.range?.out ?? Infinity)
  const totalFrames = to - from
  if (totalFrames <= 0) throw new Error('There is nothing to export in the selected range.')

  // yuv420p needs even dimensions.
  const width = settings.width & ~1
  const height = settings.height & ~1
  // Sources Chromium cannot decode are exported through a full-resolution, near-lossless intermediate.
  const proxies = { ready: () => null, require: (path: string) => api.library.proxy(path, 'full') }
  const renderer = new SceneRenderer(new OffscreenCanvas(width, height), { ...api, proxies }, true)
  renderer.compositor.setSize(project.settings.width, project.settings.height, width / project.settings.width)
  // setSize rounds from the project size; force the exact encoder dimensions.
  renderer.compositor.canvas.width = width
  renderer.compositor.canvas.height = height
  const pixels = new Uint8Array(width * height * 4)

  // Text is rasterised on a canvas, which silently falls back if the bundled font is still loading.
  await document.fonts.load('16px "Inter Variable"').catch(() => {})

  api.progress({ state: 'running', phase: 'audio', frame: 0, totalFrames })
  const audioPath = await api.beginAudio()
  const hasAudio =
    format.audio !== null &&
    (await mixdown(
      project,
      renderer.pool,
      from,
      to,
      (chunk) => api.appendAudio(chunk),
      (fraction) =>
        !format.video &&
        api.progress({
          state: 'running',
          phase: 'audio',
          frame: Math.round(fraction * totalFrames),
          totalFrames
        }),
      () => aborted
    ))
  await api.endAudio()
  if (aborted) throw new Aborted()
  if (!format.video && !hasAudio) throw new Error('There is no sound to export in the selected range.')

  const encode = async (encoder: ResolvedEncoder | null): Promise<void> => {
    await api.startEncoder({
      width,
      height,
      fps: fpsToRational(project.settings.fps),
      outputPath: request.outputPath,
      format: format.id,
      encoder,
      quality: settings.quality,
      audio: hasAudio
        ? { path: audioPath, sampleRate: project.settings.sampleRate, bitrateKbps: settings.audioBitrateKbps }
        : null
    })
    let lastReport = 0
    for (let n = 0; encoder && n < totalFrames; n++) {
      if (aborted) throw new Aborted()
      await renderer.drawExact(project, from + n)
      renderer.compositor.readPixels(pixels)
      await api.writeFrame(pixels)
      const now = performance.now()
      if (now - lastReport > 150) {
        lastReport = now
        api.progress({ state: 'running', phase: 'video', frame: n + 1, totalFrames, encoder: encoder.label })
      }
    }
    api.progress({
      state: 'running',
      phase: 'finishing',
      frame: totalFrames,
      totalFrames,
      encoder: encoder?.label
    })
    await api.finish()
  }

  let failure: unknown = null
  // Audio-only formats have no video encoder to try.
  for (const encoder of format.video ? encoders : [null]) {
    try {
      await encode(encoder)
      failure = null
      break
    } catch (error) {
      await api.discardEncoder()
      if (error instanceof Aborted) throw error
      // Hardware encoders fail in creative ways (driver limits, busy GPU); fall back to the next one.
      console.warn(`[export] ${encoder?.name ?? 'audio'} failed`, error)
      failure = error
    }
  }
  if (failure) throw failure
  api.progress({ state: 'done', phase: 'finishing', frame: totalFrames, totalFrames })
}

run()
  .catch(async (error: unknown) => {
    await api.discardEncoder().catch(() => {})
    if (error instanceof Aborted || aborted) {
      api.progress({ state: 'cancelled', phase: 'video', frame: 0, totalFrames: 0 })
    } else {
      console.error(error)
      api.progress({
        state: 'error',
        phase: 'video',
        frame: 0,
        totalFrames: 0,
        message: error instanceof Error ? error.message : String(error)
      })
    }
  })
  .finally(() => api.cleanup())
