import { AudioBufferSink } from 'mediabunny'
import { collectAudioSources, findMedia } from '@core/index'
import type { AudioSource, Project } from '@core/index'
import type { MediaPool } from '../decode/MediaPool'
import { scheduleBuffer, type ScheduleContext } from './schedule'

/** How far ahead of the playhead audio is decoded and queued. */
const LOOKAHEAD_SECONDS = 1.5
const START_DELAY_SECONDS = 0.06

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Live audio: streams every audible clip into a Web Audio graph. Its clock drives playback. */
export class AudioEngine {
  readonly context = new AudioContext({ latencyHint: 'interactive' })
  readonly analyser: AnalyserNode
  private readonly master: GainNode
  private generation = 0
  private nodes = new Set<AudioBufferSourceNode>()
  private timelineOrigin = 0
  private contextOrigin = 0

  constructor(private readonly pool: MediaPool) {
    this.master = this.context.createGain()
    this.analyser = this.context.createAnalyser()
    this.analyser.fftSize = 1024
    this.master.connect(this.analyser).connect(this.context.destination)
  }

  /** Current timeline position in seconds while playing. */
  get time(): number {
    return this.timelineOrigin + Math.max(0, this.context.currentTime - this.contextOrigin)
  }

  set volume(value: number) {
    this.master.gain.value = value
  }

  async start(project: Project, fromSeconds: number): Promise<void> {
    this.stop()
    await this.context.resume()
    const generation = this.generation
    this.timelineOrigin = fromSeconds
    this.contextOrigin = this.context.currentTime + START_DELAY_SECONDS
    const sc: ScheduleContext = {
      context: this.context,
      destination: this.master,
      fps: project.settings.fps,
      timelineOrigin: this.timelineOrigin,
      contextOrigin: this.contextOrigin
    }
    for (const source of collectAudioSources(project)) {
      const end = (source.clip.start + source.clip.duration) / sc.fps
      if (end > fromSeconds) void this.stream(project, source, sc, generation)
    }
  }

  stop(): void {
    this.generation++
    for (const node of this.nodes) {
      node.onended = null
      node.stop()
      node.disconnect()
    }
    this.nodes.clear()
  }

  private async stream(
    project: Project,
    source: AudioSource,
    sc: ScheduleContext,
    generation: number
  ): Promise<void> {
    const { clip } = source
    const alive = (): boolean => generation === this.generation
    const clipStart = clip.start / sc.fps

    // Far-away clips wait before opening a decoder.
    while (alive() && clipStart - this.time > LOOKAHEAD_SECONDS * 2) await sleep(250)
    if (!alive()) return

    const media = findMedia(project, source.mediaId)
    const open = media && (await this.pool.open(media.path))
    if (!open?.audio || !open.audioDecodable || !alive()) return

    const playFrom = Math.max(sc.timelineOrigin, clipStart)
    const sourceFrom = clip.sourceIn + (playFrom - clipStart) * clip.speed
    const sourceTo = clip.sourceIn + (clip.duration / sc.fps) * clip.speed
    try {
      for await (const { buffer, timestamp } of new AudioBufferSink(open.audio).buffers(
        sourceFrom,
        sourceTo
      )) {
        if (!alive()) return
        const node = scheduleBuffer(sc, clip, buffer, timestamp, sc.timelineOrigin)
        if (node) {
          this.nodes.add(node)
          node.addEventListener('ended', () => this.nodes.delete(node))
        }
        const bufferTimeline = clipStart + (timestamp - clip.sourceIn) / clip.speed
        while (alive() && bufferTimeline - this.time > LOOKAHEAD_SECONDS) await sleep(100)
      }
    } catch (error) {
      if (alive()) console.warn('[audio]', error)
    }
  }

  dispose(): void {
    this.stop()
    void this.context.close()
  }
}
