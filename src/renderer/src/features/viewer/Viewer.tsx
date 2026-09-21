import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronFirst, ChevronLast, Pause, Play, StepBack, StepForward, Volume2, VolumeX } from 'lucide-react'
import { formatTimecode, projectDuration } from '@core/index'
import {
  attachPlayer,
  getPlayer,
  seek,
  seekToEnd,
  stepFrames,
  togglePlayback
} from '@/engine/playback/session'
import { useEditor } from '@/store/editor'
import { IconButton } from '@/ui/IconButton'
import { Gizmo } from './Gizmo'

const QUALITIES = [
  { label: 'Full', value: 1 },
  { label: '1/2', value: 0.5 },
  { label: '1/4', value: 0.25 }
]

export function Viewer() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const playing = useEditor((s) => s.playing)
  const fps = useEditor((s) => s.project.settings.fps)
  const width = useEditor((s) => s.project.settings.width)
  const height = useEditor((s) => s.project.settings.height)
  const [quality, setQuality] = useState(1)
  const [muted, setMuted] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const [stage, setStage] = useState({ width: 0, height: 0 })

  useLayoutEffect(() => {
    const element = stageRef.current!
    const observer = new ResizeObserver(() =>
      setStage({ width: element.clientWidth, height: element.clientHeight })
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // Fit the picture inside the stage with a margin, keeping the project's aspect ratio.
  const margin = 16
  const scale = Math.max(
    0,
    Math.min((stage.width - margin * 2) / width, (stage.height - margin * 2) / height)
  )
  const fitted = {
    width: width * scale,
    height: height * scale,
    left: (stage.width - width * scale) / 2,
    top: (stage.height - height * scale) / 2
  }

  useEffect(() => attachPlayer(canvasRef.current!), [])
  useEffect(() => {
    const player = getPlayer()
    if (!player) return
    player.quality = quality
    player.audio.volume = muted ? 0 : 1
    player.invalidate()
  }, [quality, muted])

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col bg-bg">
      <div ref={stageRef} className="relative min-h-0 flex-1 overflow-hidden">
        <div
          className="absolute"
          style={{ left: fitted.left, top: fitted.top, width: fitted.width, height: fitted.height }}
        >
          <canvas ref={canvasRef} className="size-full rounded-sm shadow-lg shadow-black/50" />
          {scale > 0 && <Gizmo scale={scale} width={fitted.width} height={fitted.height} />}
        </div>
      </div>
      <footer className="grid h-11 shrink-0 grid-cols-3 items-center border-t border-line bg-surface px-3">
        <Timecode fps={fps} />
        <div className="flex items-center justify-center gap-0.5">
          <IconButton label="Go to start (Home)" onClick={() => seek(0)}>
            <ChevronFirst size={16} />
          </IconButton>
          <IconButton label="Previous frame (←)" onClick={() => stepFrames(-1)}>
            <StepBack size={15} />
          </IconButton>
          <button
            type="button"
            aria-label={playing ? 'Pause (Space)' : 'Play (Space)'}
            title={playing ? 'Pause (Space)' : 'Play (Space)'}
            onClick={togglePlayback}
            className="mx-1 flex size-8 items-center justify-center rounded-full bg-fg text-bg transition-transform hover:scale-105 active:scale-95"
          >
            {playing ? (
              <Pause size={15} fill="currentColor" />
            ) : (
              <Play size={15} fill="currentColor" className="ml-0.5" />
            )}
          </button>
          <IconButton label="Next frame (→)" onClick={() => stepFrames(1)}>
            <StepForward size={15} />
          </IconButton>
          <IconButton label="Go to end (End)" onClick={seekToEnd}>
            <ChevronLast size={16} />
          </IconButton>
        </div>
        <div className="flex items-center justify-end gap-2">
          <IconButton label={muted ? 'Unmute' : 'Mute'} active={muted} onClick={() => setMuted(!muted)}>
            {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
          </IconButton>
          <select
            aria-label="Preview quality"
            title="Preview quality"
            value={quality}
            onChange={(e) => setQuality(Number(e.target.value))}
            className="h-7 rounded-md border border-line bg-raised px-1.5 text-xs text-muted outline-none hover:text-fg"
          >
            {QUALITIES.map((q) => (
              <option key={q.value} value={q.value}>
                {q.label}
              </option>
            ))}
          </select>
        </div>
      </footer>
    </section>
  )
}

function Timecode({ fps }: { fps: number }) {
  const playhead = useEditor((s) => s.playhead)
  const duration = useEditor((s) => projectDuration(s.project))
  return (
    <div className="font-mono text-xs tabular-nums">
      <span className="text-fg">{formatTimecode(playhead, fps)}</span>
      <span className="text-faint"> / {formatTimecode(duration, fps)}</span>
    </div>
  )
}
