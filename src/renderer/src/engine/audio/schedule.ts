import type { AudioBufferSink } from 'mediabunny'
import { sourceGainAt } from '@core/index'
import type { AudibleClip, AudioSource } from '@core/index'

export interface ScheduleContext {
  context: BaseAudioContext
  destination: AudioNode
  fps: number
  /** Timeline second that corresponds to `contextOrigin` on the context's clock. */
  timelineOrigin: number
  contextOrigin: number
}

/** Gain automation points are this far apart (seconds), so curves (crossfades, keyframes) stay smooth. */
const GAIN_STEP_SECONDS = 0.02

/** Timeline seconds during which a source sounds: the clip plus any crossfade overhang. */
export function sourceWindow(source: AudioSource, fps: number): [number, number] {
  const { clip, crossIn, crossOut } = source
  return [(clip.start - crossIn) / fps, (clip.start + clip.duration + crossOut) / fps]
}

/**
 * Places one decoded buffer of a source's audio on the context timeline, trimmed to the source's window
 * and shaped by its gain envelope. Shared by live playback and the offline export mix, so they sound the
 * same. Returns the node, or null when the buffer lies outside the window.
 */
export function scheduleBuffer(
  sc: ScheduleContext,
  source: AudioSource,
  buffer: AudioBuffer,
  sourceTimestamp: number,
  /** Nothing is scheduled before this timeline second (the play/chunk start). */
  notBefore: number,
  notAfter = Infinity
): AudioBufferSourceNode | null {
  const { clip } = source
  const clipStart = clip.start / sc.fps
  const [windowFrom, windowTo] = sourceWindow(source, sc.fps)
  const windowStart = Math.max(windowFrom, notBefore)
  const windowEnd = Math.min(windowTo, notAfter)

  // Timeline span this buffer covers.
  const begin = clipStart + (sourceTimestamp - clip.sourceIn) / clip.speed
  const end = begin + buffer.duration / clip.speed
  const from = Math.max(begin, windowStart)
  const to = Math.min(end, windowEnd)
  if (to - from <= 1e-6) return null

  const node = sc.context.createBufferSource()
  node.buffer = buffer
  node.playbackRate.value = clip.speed
  const gain = sc.context.createGain()
  const at = (timeline: number): number => sc.contextOrigin + (timeline - sc.timelineOrigin)
  const level = (timeline: number): number => sourceGainAt(source, timeline * sc.fps - clip.start)
  gain.gain.setValueAtTime(level(from), at(from))
  for (let t = from + GAIN_STEP_SECONDS; t < to; t += GAIN_STEP_SECONDS)
    gain.gain.linearRampToValueAtTime(level(t), at(t))
  gain.gain.linearRampToValueAtTime(level(to), at(to))
  node.connect(gain).connect(sc.destination)
  node.start(at(from), (from - begin) * clip.speed, (to - from) * clip.speed)
  node.onended = () => gain.disconnect()
  return node
}

/** Reversed audio is decoded and flipped in windows of this many timeline seconds. */
const REVERSE_WINDOW_SECONDS = 2

/** Source seconds that play during timeline seconds [from, to) of a clip. */
function sourceRange(clip: AudibleClip, fps: number, from: number, to: number): [number, number] {
  const clipStart = clip.start / fps
  if (!clip.reversed)
    return [clip.sourceIn + (from - clipStart) * clip.speed, clip.sourceIn + (to - clipStart) * clip.speed]
  const clipEnd = (clip.start + clip.duration) / fps
  return [clip.sourceIn + (clipEnd - to) * clip.speed, clip.sourceIn + (clipEnd - from) * clip.speed]
}

/**
 * Decoded audio for timeline seconds [from, to) of a clip, in timeline order. Each buffer comes with the
 * source timestamp it would have if the clip played forwards, which is what `scheduleBuffer` expects:
 * reversed clips are decoded window by window and flipped, so they schedule like any other buffer.
 */
export async function* clipAudio(
  sink: AudioBufferSink,
  clip: AudibleClip,
  fps: number,
  from: number,
  to: number,
  context: BaseAudioContext
): AsyncGenerator<{ buffer: AudioBuffer; timestamp: number }> {
  if (!clip.reversed) {
    const [a, b] = sourceRange(clip, fps, from, to)
    yield* sink.buffers(a, b)
    return
  }
  const clipStart = clip.start / fps
  for (let windowStart = from; windowStart < to - 1e-6; windowStart += REVERSE_WINDOW_SECONDS) {
    const windowEnd = Math.min(to, windowStart + REVERSE_WINDOW_SECONDS)
    const [a, b] = sourceRange(clip, fps, windowStart, windowEnd)
    const parts: Array<{ buffer: AudioBuffer; timestamp: number }> = []
    for await (const part of sink.buffers(a, b)) parts.push(part)
    if (parts.length === 0) continue
    const rate = parts[0]!.buffer.sampleRate
    const channels = Math.max(...parts.map((p) => p.buffer.numberOfChannels))
    const length = Math.max(1, Math.round((b - a) * rate))
    const out = context.createBuffer(channels, length, rate)
    for (let channel = 0; channel < channels; channel++) {
      const target = out.getChannelData(channel)
      for (const { buffer, timestamp } of parts) {
        const data = buffer.getChannelData(Math.min(channel, buffer.numberOfChannels - 1))
        const offset = Math.round((timestamp - a) * rate)
        const first = Math.max(0, -offset)
        const last = Math.min(data.length, length - offset)
        for (let i = first; i < last; i++) target[length - 1 - (offset + i)] = data[i]!
      }
    }
    yield { buffer: out, timestamp: clip.sourceIn + (windowStart - clipStart) * clip.speed }
  }
}
