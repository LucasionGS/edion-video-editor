import { projectDuration } from '@core/index'
import { setPlayhead, useEditor } from '@/store/editor'
import { editorProxies, onProxyReady } from '../proxies'
import { Player } from './Player'

/** The single live Player, bound to the viewer canvas, plus the glue that keeps it in step with the store. */
let player: Player | null = null
let unsubscribe: (() => void) | null = null

export const getPlayer = (): Player | null => player

export function attachPlayer(canvas: HTMLCanvasElement): () => void {
  player = new Player(
    canvas,
    { media: window.edion.media, library: window.edion.library, proxies: editorProxies },
    {
      getProject: () => useEditor.getState().project,
      getPlayhead: () => useEditor.getState().playhead,
      onFrame: (frame) => useEditor.setState({ playhead: frame }),
      onStop: () => useEditor.setState({ playing: false })
    }
  )
  const current = player
  unsubscribe = useEditor.subscribe((state, previous) => {
    if (state.project !== previous.project) current.projectChanged()
    else if (state.playhead !== previous.playhead) current.invalidate()
    if (state.playing !== previous.playing) {
      if (state.playing) void current.play()
      else current.pause()
    }
  })
  void document.fonts.load('16px "Inter Variable"').then(() => {
    current.renderer.compositor.clearRasters()
    current.invalidate()
  })
  const offProxy = onProxyReady((path) => current.renderer.resetMedia(path))
  return () => {
    offProxy()
    unsubscribe?.()
    current.dispose()
    if (player === current) player = null
  }
}

export const togglePlayback = (): void => useEditor.setState((s) => ({ playing: !s.playing }))

/** Moves the playhead; during playback the audio clock jumps along. */
export function seek(frame: number): void {
  const { project, playing } = useEditor.getState()
  const clamped = Math.max(0, Math.round(frame))
  setPlayhead(clamped)
  if (playing && player) void player.audio.start(project, clamped / project.settings.fps)
}

export const stepFrames = (delta: number): void => {
  useEditor.setState({ playing: false })
  seek(useEditor.getState().playhead + delta)
}

export const seekToEnd = (): void => seek(projectDuration(useEditor.getState().project))

/** J/K/L-style shuttle is approximated with jumps: ±1 s. */
export const jumpSeconds = (seconds: number): void => {
  const { project, playhead } = useEditor.getState()
  seek(playhead + seconds * project.settings.fps)
}
