import { projectDuration } from '@core/index'
import type { Project } from '@core/index'
import { AudioEngine } from '../audio/AudioEngine'
import { SceneRenderer, type EngineApi } from '../SceneRenderer'

const PREROLL_SECONDS = 0.75

export interface PlayerHost {
  getProject(): Project
  getPlayhead(): number
  /** Called every displayed frame during playback. */
  onFrame(frame: number): void
  onStop(): void
}

/** Drives the preview: renders the playhead frame when paused and runs the play loop against the audio clock. */
export class Player {
  readonly renderer: SceneRenderer
  readonly audio: AudioEngine
  private raf = 0
  private dirty = true
  private playing = false
  private lastFrame = -1
  /** Preview resolution relative to the project (1 = full). */
  quality = 1
  /** Called right after every repaint, while the canvas still holds the frame (e.g. for scopes). */
  readonly drawListeners = new Set<(canvas: HTMLCanvasElement) => void>()

  constructor(
    private readonly canvas: HTMLCanvasElement,
    api: EngineApi,
    private readonly host: PlayerHost
  ) {
    this.renderer = new SceneRenderer(canvas, api)
    this.renderer.onContentReady = () => this.invalidate()
    this.audio = new AudioEngine(this.renderer.pool)
    this.raf = requestAnimationFrame(this.loop)
  }

  get isPlaying(): boolean {
    return this.playing
  }

  /** Request a repaint (project or playhead changed, or new pixels arrived). */
  invalidate(): void {
    this.dirty = true
  }

  async play(): Promise<void> {
    if (this.playing) return
    const project = this.host.getProject()
    const duration = projectDuration(project)
    if (duration === 0) return this.host.onStop()
    let from = this.host.getPlayhead()
    if (from >= duration - 1) from = 0
    this.playing = true
    this.host.onFrame(from)
    await this.audio.start(project, from / project.settings.fps)
  }

  pause(): void {
    if (!this.playing) return
    this.playing = false
    this.audio.stop()
    this.host.onStop()
    this.invalidate()
  }

  /** The project changed mid-playback: re-sync audio to the edit without stopping. */
  projectChanged(): void {
    this.invalidate()
    if (this.playing) void this.audio.start(this.host.getProject(), this.audio.time)
  }

  private readonly loop = (): void => {
    this.raf = requestAnimationFrame(this.loop)
    const project = this.host.getProject()
    const { fps, width, height } = project.settings
    this.renderer.compositor.setSize(width, height, this.quality)

    if (this.playing) {
      const frame = Math.floor(this.audio.time * fps + 1e-6)
      if (frame >= projectDuration(project)) {
        this.host.onFrame(projectDuration(project))
        return this.pause()
      }
      if (frame !== this.lastFrame) {
        this.lastFrame = frame
        this.host.onFrame(frame)
        this.draw(project, frame)
        this.renderer.preroll(project, frame + Math.round(PREROLL_SECONDS * fps))
      } else if (this.dirty) this.draw(project, frame)
      this.dirty = false
      return
    }
    if (!this.dirty) return
    this.dirty = false
    this.lastFrame = -1
    this.draw(project, this.host.getPlayhead())
  }

  private draw(project: Project, frame: number): void {
    this.renderer.draw(project, frame)
    for (const listener of this.drawListeners) listener(this.canvas)
  }

  dispose(): void {
    cancelAnimationFrame(this.raf)
    this.audio.dispose()
    this.renderer.dispose()
  }
}
