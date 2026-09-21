import { VideoSampleSink } from 'mediabunny'
import { FrameRenderer } from './engine/compositor/FrameRenderer'
import { openMediaInput } from './engine/decode/mediaInput'

/**
 * Milestone-1 export runner: decode → WebGL → raw RGBA → FFmpeg, at a constant frame rate.
 * Runs in the hidden export window so the editor stays responsive.
 */
async function run(): Promise<void> {
  const api = window.edionExport
  let aborted = false
  api.onAbort(() => (aborted = true))

  const job = await api.getJob()
  const input = await openMediaInput(api.media, job.inputPath)
  const track = await input.getPrimaryVideoTrack()
  if (!track) throw new Error('The file has no video track')
  if (!(await track.canDecode())) throw new Error(`Cannot decode codec "${track.codec}"`)

  const stats = await track.computePacketStats(120)
  const fps = Math.min(120, Math.max(1, Math.round(stats.averagePacketRate * 1000) / 1000))
  const duration = await track.computeDuration()
  const start = await track.getFirstTimestamp()
  const totalFrames = Math.max(1, Math.round((duration - start) * fps))

  // yuv420p needs even dimensions.
  const width = track.displayWidth & ~1
  const height = track.displayHeight & ~1
  const renderer = new FrameRenderer(new OffscreenCanvas(width, height), true)
  const pixels = new Uint8Array(width * height * 4)

  await api.startEncoder({ width, height, fps, outputPath: job.outputPath, audioPath: job.inputPath })

  const sink = new VideoSampleSink(track)
  const timestamps = Array.from({ length: totalFrames }, (_, n) => start + n / fps)
  let frame = 0
  let lastReport = 0
  for await (const sample of sink.samplesAtTimestamps(timestamps)) {
    if (aborted) {
      sample?.close()
      return
    }
    if (sample) {
      const videoFrame = sample.toVideoFrame()
      renderer.draw(videoFrame, videoFrame.displayWidth, videoFrame.displayHeight)
      videoFrame.close()
      sample.close()
      renderer.readPixels(pixels)
    }
    // A missing sample repeats the previous frame.
    await api.writeFrame(pixels)
    frame++
    const now = performance.now()
    if (now - lastReport > 100) {
      lastReport = now
      api.progress({ frame, totalFrames, state: 'running' })
    }
  }
  if (aborted) return
  await api.finish()
  api.progress({ frame, totalFrames, state: 'done' })
}

run().catch((error: unknown) => {
  console.error(error)
  window.edionExport.progress({
    frame: 0,
    totalFrames: 0,
    state: 'error',
    message: error instanceof Error ? error.message : String(error)
  })
})
