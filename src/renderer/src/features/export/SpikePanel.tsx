import { useEffect, useRef, useState } from 'react'
import { VideoSampleSink } from 'mediabunny'
import { Download, FolderOpen, X } from 'lucide-react'
import type { ExportProgress, MediaProbe } from '@shared/ipc'
import { FrameRenderer } from '@/engine/compositor/FrameRenderer'
import { openMediaInput } from '@/engine/decode/mediaInput'
import { Button } from '@/ui/Button'
import { PanelFrame } from '@/ui/Panel'

/** Milestone-1 vertical slice: open a file, preview a frame through WebGL, re-encode it through the export pipeline. */
export function SpikePanel() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [media, setMedia] = useState<MediaProbe | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [progress, setProgress] = useState<ExportProgress | null>(null)

  useEffect(() => window.edion.export.onProgress(setProgress), [])
  useEffect(() => {
    if (progress && progress.state !== 'running') setJobId(null)
  }, [progress])

  async function load(path: string): Promise<void> {
    setError(null)
    setProgress(null)
    try {
      const info = await window.edion.ffmpeg.probe(path)
      setMedia(info)
      const input = await openMediaInput(window.edion.media, path)
      const track = await input.getPrimaryVideoTrack()
      const canvas = canvasRef.current
      if (!track || !canvas) return
      if (!(await track.canDecode()))
        throw new Error(`Cannot decode "${track.codec}" — a proxy will be needed`)
      const sample = await new VideoSampleSink(track).getSample(Math.min(1, info.duration / 2))
      if (!sample) return
      canvas.width = track.displayWidth
      canvas.height = track.displayHeight
      const frame = sample.toVideoFrame()
      new FrameRenderer(canvas).draw(frame, frame.displayWidth, frame.displayHeight)
      frame.close()
      sample.close()
      input.dispose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function pick(): Promise<void> {
    const [path] = await window.edion.dialog.openMedia()
    if (path) await load(path)
  }

  async function startExport(): Promise<void> {
    if (!media) return
    const name =
      media.path
        .split(/[\\/]/)
        .pop()
        ?.replace(/\.[^.]+$/, '') ?? 'export'
    const outputPath = await window.edion.dialog.saveFile(`${name}-edion.mp4`, ['mp4'])
    if (!outputPath) return
    setProgress(null)
    setJobId(await window.edion.export.start({ inputPath: media.path, outputPath }))
  }

  const video = media?.streams.find((s) => s.kind === 'video')
  const percent = progress?.totalFrames ? Math.round((progress.frame / progress.totalFrames) * 100) : 0

  return (
    <PanelFrame
      title="Viewer"
      actions={
        <div className="flex gap-1.5">
          <Button variant="ghost" onClick={() => void pick()}>
            <FolderOpen size={14} /> Open
          </Button>
          {jobId ? (
            <Button onClick={() => void window.edion.export.cancel(jobId)}>
              <X size={14} /> Cancel
            </Button>
          ) : (
            <Button variant="primary" disabled={!video} onClick={() => void startExport()}>
              <Download size={14} /> Export
            </Button>
          )}
        </div>
      }
    >
      <div
        className="flex h-full flex-col bg-bg"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          const file = e.dataTransfer.files[0]
          if (file) void load(window.edion.media.pathForFile(file))
        }}
      >
        <div className="flex min-h-0 flex-1 items-center justify-center p-4">
          <canvas ref={canvasRef} className={`max-h-full max-w-full rounded ${media ? '' : 'hidden'}`} />
          {!media && <p className="text-xs text-faint">Open or drop a video to test the pipeline</p>}
        </div>
        <footer className="flex h-8 shrink-0 items-center gap-3 border-t border-line px-3 text-2xs text-muted">
          {error && <span className="text-danger">{error}</span>}
          {!error && video && (
            <span>
              {video.codec} · {video.width}×{video.height} · {video.fps?.toFixed(2)} fps ·{' '}
              {media?.duration.toFixed(2)} s
            </span>
          )}
          {progress && (
            <span className="ml-auto flex items-center gap-2">
              {progress.state === 'running' && (
                <>
                  <span className="h-1 w-32 overflow-hidden rounded bg-raised">
                    <span className="block h-full bg-accent" style={{ width: `${percent}%` }} />
                  </span>
                  {percent}%
                </>
              )}
              {progress.state === 'done' && <span className="text-ok">Export complete</span>}
              {progress.state === 'cancelled' && <span>Export cancelled</span>}
              {progress.state === 'error' && <span className="text-danger">{progress.message}</span>}
            </span>
          )}
        </footer>
      </div>
    </PanelFrame>
  )
}
