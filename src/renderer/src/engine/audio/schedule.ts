import { gainAt } from '@core/index'
import type { AudibleClip } from '@core/index'

export interface ScheduleContext {
  context: BaseAudioContext
  destination: AudioNode
  fps: number
  /** Timeline second that corresponds to `contextOrigin` on the context's clock. */
  timelineOrigin: number
  contextOrigin: number
}

/**
 * Places one decoded buffer of a clip's source audio on the context timeline, trimmed to the clip
 * and shaped by the clip's gain envelope. Shared by live playback and the offline export mix,
 * so they sound the same. Returns the node, or null when the buffer lies outside the clip.
 */
export function scheduleBuffer(
  sc: ScheduleContext,
  clip: AudibleClip,
  buffer: AudioBuffer,
  sourceTimestamp: number,
  /** Nothing is scheduled before this timeline second (the play/chunk start). */
  notBefore: number,
  notAfter = Infinity
): AudioBufferSourceNode | null {
  const clipStart = clip.start / sc.fps
  const clipEnd = (clip.start + clip.duration) / sc.fps
  const windowStart = Math.max(clipStart, notBefore)
  const windowEnd = Math.min(clipEnd, notAfter)

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
  const when = sc.contextOrigin + (from - sc.timelineOrigin)
  const until = sc.contextOrigin + (to - sc.timelineOrigin)
  gain.gain.setValueAtTime(gainAt(clip, from * sc.fps - clip.start), when)
  gain.gain.linearRampToValueAtTime(gainAt(clip, to * sc.fps - clip.start), until)
  node.connect(gain).connect(sc.destination)
  node.start(when, (from - begin) * clip.speed, (to - from) * clip.speed)
  node.onended = () => gain.disconnect()
  return node
}
