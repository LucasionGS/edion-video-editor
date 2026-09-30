import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { BetweenHorizontalStart, Pause, Play, Replace, StepBack, StepForward, X } from 'lucide-react'
import { createProject, findMedia, formatClock } from '@core/index'
import { Player } from '@/engine/playback/Player'
import { editorProxies } from '@/engine/proxies'
import { startDrag } from '@/features/timeline/drag'
import { useEditor } from '@/store/editor'
import {
  markSource,
  placeSource,
  seekSource,
  showSource,
  sourceLength,
  sourceProject,
  stepSource,
  toggleSourcePlayback,
  useSource
} from '@/store/source'
import { Button } from '@/ui/Button'
import { IconButton } from '@/ui/IconButton'

/**
 * The source monitor: plays one media file on its own player, with in and out marks, and places the
 * marked part on the timeline at the playhead (insert or overwrite).
 */
export function SourceViewer() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [stage, setStage] = useState({ width: 0, height: 0 })
  const assetId = useSource((s) => s.assetId)
  const playing = useSource((s) => s.playing)
  const playhead = useSource((s) => s.playhead)
  const markIn = useSource((s) => s.markIn)
  const markOut = useSource((s) => s.markOut)
  const asset = useEditor((s) => (assetId ? findMedia(s.project, assetId) : undefined))
  const settings = useEditor((s) => s.project.settings)
  const project = useMemo(() => (asset ? sourceProject(asset, settings) : null), [asset, settings])
  const projectRef = useRef(project)
  projectRef.current = project
  const playerRef = useRef<Player | null>(null)
  const length = sourceLength(asset)
  const { fps, width, height } = settings

  useLayoutEffect(() => {
    const element = stageRef.current!
    const observer = new ResizeObserver(() =>
      setStage({ width: element.clientWidth, height: element.clientHeight })
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const player = new Player(
      canvasRef.current!,
      { media: window.edion.media, proxies: editorProxies },
      {
        getProject: () => projectRef.current ?? createProject(),
        getPlayhead: () => useSource.getState().playhead,
        onFrame: (frame) => useSource.setState({ playhead: frame }),
        onStop: () => useSource.setState({ playing: false })
      }
    )
    playerRef.current = player
    const unsubscribe = useSource.subscribe((state, previous) => {
      if (state.playhead !== previous.playhead) player.invalidate()
      if (state.playing !== previous.playing) {
        if (state.playing) void player.play()
        else player.pause()
      }
    })
    return () => {
      unsubscribe()
      player.dispose()
      playerRef.current = null
    }
  }, [])
  useEffect(() => playerRef.current?.projectChanged(), [project])

  const margin = 16
  const scale = Math.max(
    0,
    Math.min((stage.width - margin * 2) / width, (stage.height - margin * 2) / height)
  )
  const marked = (markOut ?? length) - (markIn ?? 0)

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col bg-bg">
      <div ref={stageRef} className="relative min-h-0 flex-1 overflow-hidden">
        <canvas
          ref={canvasRef}
          className="absolute rounded-sm shadow-lg shadow-black/50"
          style={{
            width: width * scale,
            height: height * scale,
            left: (stage.width - width * scale) / 2,
            top: (stage.height - height * scale) / 2
          }}
        />
        <div className="absolute top-2 left-2 flex items-center gap-1.5 rounded-md bg-black/60 py-0.5 pr-0.5 pl-2 text-2xs text-white">
          Source · {asset?.name ?? 'nothing loaded'}
          <IconButton
            label="Back to the timeline"
            className="size-5 text-white/80"
            onClick={() => showSource(false)}
          >
            <X size={12} />
          </IconButton>
        </div>
      </div>
      <Scrubber length={length} playhead={playhead} markIn={markIn} markOut={markOut} />
      <footer className="@container grid h-11 min-w-0 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 border-t border-line bg-surface px-3">
        <span className="min-w-0 truncate font-mono text-xs tabular-nums">
          {formatClock(playhead / fps, 3)}
          <span className="text-faint @max-[600px]:hidden"> · marked {formatClock(marked / fps, 2)}</span>
        </span>
        <div className="flex items-center justify-center gap-0.5">
          <IconButton label="Mark in (I)" onClick={() => markSource('in')}>
            <span className="font-mono text-sm leading-none">{'{'}</span>
          </IconButton>
          <IconButton label="Previous frame (←)" onClick={() => stepSource(-1)}>
            <StepBack size={15} />
          </IconButton>
          <button
            type="button"
            aria-label={playing ? 'Pause (Space)' : 'Play (Space)'}
            title={playing ? 'Pause (Space)' : 'Play (Space)'}
            onClick={toggleSourcePlayback}
            className="mx-1 flex size-8 items-center justify-center rounded-full bg-fg text-bg transition-transform hover:scale-105 active:scale-95"
          >
            {playing ? (
              <Pause size={15} fill="currentColor" />
            ) : (
              <Play size={15} fill="currentColor" className="ml-0.5" />
            )}
          </button>
          <IconButton label="Next frame (→)" onClick={() => stepSource(1)}>
            <StepForward size={15} />
          </IconButton>
          <IconButton label="Mark out (O)" onClick={() => markSource('out')}>
            <span className="font-mono text-sm leading-none">{'}'}</span>
          </IconButton>
        </div>
        <div className="flex min-w-0 items-center justify-end gap-1">
          <Button title="Insert at the timeline playhead (,)" onClick={() => placeSource('insert')}>
            <BetweenHorizontalStart size={13} />
            <span className="@max-[640px]:hidden">Insert</span>
          </Button>
          <Button title="Overwrite at the timeline playhead (.)" onClick={() => placeSource('overwrite')}>
            <Replace size={13} />
            <span className="@max-[640px]:hidden">Overwrite</span>
          </Button>
        </div>
      </footer>
    </section>
  )
}

/** A bar for the whole source: click or drag to seek; the marked part is highlighted. */
function Scrubber({
  length,
  playhead,
  markIn,
  markOut
}: {
  length: number
  playhead: number
  markIn: number | null
  markOut: number | null
}) {
  const at = (frame: number): string => `${(frame / Math.max(1, length)) * 100}%`
  const seekTo = (element: HTMLElement, clientX: number): void => {
    const rect = element.getBoundingClientRect()
    seekSource(((clientX - rect.left) / rect.width) * length)
  }
  return (
    <div
      className="relative h-5 shrink-0 cursor-ew-resize border-t border-line bg-surface"
      onPointerDown={(e) => {
        const element = e.currentTarget
        useSource.setState({ playing: false })
        seekTo(element, e.clientX)
        startDrag(e, { threshold: 0, onMove: (_dx, _dy, ev) => seekTo(element, ev.clientX) })
      }}
    >
      {(markIn !== null || markOut !== null) && (
        <div
          className="absolute inset-y-1 rounded-sm bg-accent-soft ring-1 ring-accent/60"
          style={{ left: at(markIn ?? 0), width: `calc(${at((markOut ?? length) - (markIn ?? 0))})` }}
        />
      )}
      <div className="absolute inset-y-0 w-px bg-white" style={{ left: at(playhead) }} />
    </div>
  )
}
