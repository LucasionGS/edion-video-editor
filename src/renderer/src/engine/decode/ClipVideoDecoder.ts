import { VideoSampleSink, type InputVideoTrack, type VideoSample } from 'mediabunny'

/** Forward jumps larger than this restart decoding at the target instead of decoding through the gap. */
const MAX_FORWARD_DECODE_SECONDS = 2
/** Backward steps up to this size (reverse playback, stepping back) are served from a decoded window. */
const MAX_BACKWARD_STEP_SECONDS = 1
/** Frames decoded per backward window: each window costs one decode run from the previous keyframe. */
const BACKWARD_WINDOW_FRAMES = 15

/**
 * Frame-accurate video access for one clip. Decoding is sequential (cheap) while time moves
 * forward and restarts from the nearest keyframe on any other jump. Small backward steps (a reversed
 * clip, stepping back frame by frame) decode a short window once and then walk back through it.
 */
export class ClipVideoDecoder {
  /** The frame to show for the most recently served time. Owned by the decoder; do not close. */
  current: VideoFrame | null = null
  private next: VideoFrame | null = null
  private iterator: AsyncGenerator<VideoSample, void, unknown> | null = null
  private ended = false

  private wanted: number | null = null
  private running: Promise<void> | null = null
  private disposed = false
  private rotateCanvas: OffscreenCanvas | null = null

  private readonly sink: VideoSampleSink
  private readonly tolerance: number
  private readonly frameSeconds: number
  /** Copies of the frames in the last backward window, oldest first, and the time it was decoded up to. */
  private window: VideoFrame[] = []
  private windowUntil = -1

  constructor(
    track: InputVideoTrack,
    fps: number,
    /** Called when a requested frame became available (used to repaint while paused). */
    private readonly onFrame?: () => void
  ) {
    this.sink = new VideoSampleSink(track)
    // Pick the frame whose timestamp is nearest below the target, forgiving rounding and 29.97-vs-30 drift.
    this.tolerance = 0.4 / Math.max(1, fps)
    this.frameSeconds = 1 / Math.max(1, fps)
  }

  /** Non-blocking: asks for `time` and returns immediately. `current` updates when decoding catches up. */
  request(time: number): void {
    this.wanted = time
    this.running ??= this.serve().finally(() => (this.running = null))
  }

  /** Blocking and exact; used by the exporter. */
  async frameAt(time: number): Promise<VideoFrame | null> {
    while (this.running) await this.running
    await this.advanceTo(time)
    return this.current
  }

  private async serve(): Promise<void> {
    while (this.wanted !== null && !this.disposed) {
      const time = this.wanted
      this.wanted = null
      try {
        await this.advanceTo(time)
      } catch (error) {
        console.warn('[decode]', error)
        await this.stopIterator()
      }
      this.onFrame?.()
    }
  }

  private async advanceTo(time: number): Promise<void> {
    const target = time + this.tolerance
    const behind = this.current !== null && target < this.current.timestamp / 1e6
    if (behind && this.current!.timestamp / 1e6 - time <= MAX_BACKWARD_STEP_SECONDS) {
      if (await this.fromWindow(time)) return
    }
    const horizon = (this.next ?? this.current)?.timestamp
    const farAhead = horizon !== undefined && time > horizon / 1e6 + MAX_FORWARD_DECODE_SECONDS
    if (!this.iterator || behind || farAhead || (this.ended && behind)) await this.restart(time)

    while (this.next && this.next.timestamp / 1e6 <= target) {
      this.current?.close()
      this.current = this.next
      this.next = await this.pull()
    }
  }

  /** Serves `time` from the backward window, decoding a new window when needed. */
  private async fromWindow(time: number): Promise<boolean> {
    const target = time + this.tolerance
    const covered = (): boolean =>
      this.window.length > 0 && this.window[0]!.timestamp / 1e6 <= target && target <= this.windowUntil
    if (!covered()) await this.decodeWindow(time)
    if (!covered()) return false
    const frame = this.window.findLast((f) => f.timestamp / 1e6 <= target)!
    this.current?.close()
    this.current = frame.clone()
    // The forward decoder is somewhere else now; the next forward request restarts it.
    await this.stopIterator()
    return true
  }

  private async decodeWindow(time: number): Promise<void> {
    this.clearWindow()
    await this.stopIterator()
    const from = Math.max(0, time - (BACKWARD_WINDOW_FRAMES - 1) * this.frameSeconds - this.tolerance)
    const until = time + this.tolerance
    for await (const sample of this.sink.samples(from, until + this.frameSeconds)) {
      if (this.disposed || sample.timestamp > until) {
        sample.close()
        break
      }
      const frame = this.toFrame(sample)
      // Copies, so the window never holds on to the decoder's (few) output surfaces.
      const bitmap = await createImageBitmap(frame)
      this.window.push(new VideoFrame(bitmap, { timestamp: frame.timestamp }))
      bitmap.close()
      frame.close()
    }
    this.windowUntil = until
  }

  private clearWindow(): void {
    for (const frame of this.window) frame.close()
    this.window = []
    this.windowUntil = -1
  }

  private async restart(time: number): Promise<void> {
    await this.stopIterator()
    this.ended = false
    this.iterator = this.sink.samples(Math.max(0, time))
    const first = await this.pull()
    this.current?.close()
    this.current = first
    this.next = first ? await this.pull() : null
  }

  private async pull(): Promise<VideoFrame | null> {
    if (!this.iterator || this.disposed) return null
    const result = await this.iterator.next()
    if (result.done) {
      this.ended = true
      return null
    }
    return this.toFrame(result.value)
  }

  /** Bakes rotation metadata (phone footage) into the pixels so the compositor never has to care. */
  private toFrame(sample: VideoSample): VideoFrame {
    try {
      if (sample.rotation === 0) return sample.toVideoFrame()
      const canvas = (this.rotateCanvas ??= new OffscreenCanvas(sample.displayWidth, sample.displayHeight))
      if (canvas.width !== sample.displayWidth || canvas.height !== sample.displayHeight) {
        canvas.width = sample.displayWidth
        canvas.height = sample.displayHeight
      }
      sample.draw(canvas.getContext('2d')!, 0, 0)
      return new VideoFrame(canvas, { timestamp: Math.round(sample.timestamp * 1e6) })
    } finally {
      sample.close()
    }
  }

  private async stopIterator(): Promise<void> {
    const iterator = this.iterator
    this.iterator = null
    this.next?.close()
    this.next = null
    await iterator?.return().catch(() => {})
  }

  async dispose(): Promise<void> {
    this.disposed = true
    this.wanted = null
    await this.running?.catch(() => {})
    await this.stopIterator()
    this.clearWindow()
    this.current?.close()
    this.current = null
  }
}
