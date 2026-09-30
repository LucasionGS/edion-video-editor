import { AudioBufferSink } from 'mediabunny'
import { collectAudioSources, findMedia } from '@core/index'
import type { Project } from '@core/index'
import type { MediaPool } from '../decode/MediaPool'
import { clipAudio, scheduleBuffer } from '../audio/schedule'

const CHUNK_SECONDS = 20

/**
 * Renders the project's audio for [fromFrame, toFrame) offline, in bounded-memory chunks, and hands
 * each chunk to `write` as interleaved stereo. Uses the same scheduling code as live playback.
 * Returns false when the range is silent (nothing was written).
 */
export async function mixdown(
  project: Project,
  pool: MediaPool,
  fromFrame: number,
  toFrame: number,
  write: (interleaved: Float32Array) => Promise<void>,
  onProgress: (fraction: number) => void,
  isAborted: () => boolean
): Promise<boolean> {
  const { fps, sampleRate } = project.settings
  const sources = collectAudioSources(project).filter(
    ({ clip }) => clip.start < toFrame && clip.start + clip.duration > fromFrame
  )
  if (sources.length === 0) return false

  const rangeStart = fromFrame / fps
  const rangeEnd = toFrame / fps
  for (let chunkStart = rangeStart; chunkStart < rangeEnd && !isAborted(); chunkStart += CHUNK_SECONDS) {
    const chunkEnd = Math.min(rangeEnd, chunkStart + CHUNK_SECONDS)
    const length = Math.max(1, Math.round((chunkEnd - chunkStart) * sampleRate))
    const context = new OfflineAudioContext(2, length, sampleRate)
    const sc = {
      context,
      destination: context.destination,
      fps,
      timelineOrigin: chunkStart,
      contextOrigin: 0
    }

    for (const { clip, mediaId } of sources) {
      const clipStart = clip.start / fps
      const clipEnd = (clip.start + clip.duration) / fps
      if (clipStart >= chunkEnd || clipEnd <= chunkStart) continue
      const media = findMedia(project, mediaId)
      const open = media && (await pool.open(media.path))
      if (!open?.audio || !open.audioDecodable) continue
      const sink = new AudioBufferSink(open.audio)
      const from = Math.max(chunkStart, clipStart)
      const to = Math.min(chunkEnd, clipEnd)
      for await (const { buffer, timestamp } of clipAudio(sink, clip, fps, from, to, context)) {
        scheduleBuffer(sc, clip, buffer, timestamp, chunkStart, chunkEnd)
      }
    }

    const rendered = await context.startRendering()
    const left = rendered.getChannelData(0)
    const right = rendered.getChannelData(1)
    const interleaved = new Float32Array(length * 2)
    for (let i = 0; i < length; i++) {
      // Summed clips may exceed full scale; clamp instead of letting the encoder wrap.
      interleaved[i * 2] = Math.max(-1, Math.min(1, left[i]!))
      interleaved[i * 2 + 1] = Math.max(-1, Math.min(1, right[i]!))
    }
    await write(interleaved)
    onProgress((chunkEnd - rangeStart) / (rangeEnd - rangeStart))
  }
  return true
}
