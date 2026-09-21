import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, CircleAlert, FolderSearch, Loader2, X } from 'lucide-react'
import { formatTimecode, projectDuration, serializeProject } from '@core/index'
import type { EncoderInfo, ExportJobState, ExportQuality } from '@shared/ipc'
import { useEditor } from '@/store/editor'
import { useExports } from '@/store/exports'
import { toast } from '@/store/feedback'
import { Button } from '@/ui/Button'
import { Field, Segmented, Select } from '@/ui/Field'
import { IconButton } from '@/ui/IconButton'
import { Modal } from '@/ui/Modal'

const HEIGHTS = [2160, 1440, 1080, 720, 480, 360]
const QUALITIES: ReadonlyArray<{ value: ExportQuality; label: string }> = [
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Small file' }
]

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const project = useEditor((s) => s.project)
  const jobs = useExports((s) => s.jobs)
  const duration = projectDuration(project)
  const { width, height, fps } = project.settings

  const [encoders, setEncoders] = useState<EncoderInfo[] | null>(null)
  const [encoder, setEncoder] = useState('auto')
  const [quality, setQuality] = useState<ExportQuality>('high')
  const [outHeight, setOutHeight] = useState(height)
  const [useRange, setUseRange] = useState(Boolean(project.range))
  const [audioBitrate, setAudioBitrate] = useState(192)

  useEffect(() => void window.edion.export.encoders().then(setEncoders), [])

  const sizes = useMemo(() => {
    // Same aspect ratio as the project, never upscaled beyond 2x, always even.
    const short = Math.min(width, height)
    const options = HEIGHTS.filter((h) => h <= short * 2).map((h) => {
      const scale = h / short
      return {
        label: `${h}p`,
        width: Math.round((width * scale) / 2) * 2,
        height: Math.round((height * scale) / 2) * 2
      }
    })
    if (!options.some((o) => o.height === height)) options.unshift({ label: 'Project', width, height })
    return options
  }, [width, height])
  const size = sizes.find((s) => s.height === outHeight) ?? sizes[0]!
  const range = useRange && project.range ? project.range : null
  const frames = range ? range.out - range.in : duration
  const hardware = encoders?.find((e) => e.hardware)

  async function start(): Promise<void> {
    const outputPath = await window.edion.dialog.saveFile(`${project.name}.mp4`, ['mp4'])
    if (!outputPath) return
    await window.edion.export.start({
      projectJson: serializeProject(project),
      name: outputPath.split(/[\\/]/).pop() ?? project.name,
      outputPath,
      settings: {
        width: size.width,
        height: size.height,
        range,
        encoder,
        quality,
        audioBitrateKbps: audioBitrate
      }
    })
    toast('Export started. You can keep editing.')
  }

  return (
    <Modal title="Export video" onClose={onClose}>
      <div className="flex flex-col gap-2.5 p-4">
        <Field label="Format">
          <span className="text-xs">MP4 · H.264 + AAC</span>
        </Field>
        <Field label="Resolution" hint={`${size.width}×${size.height}`}>
          <Select value={size.height} onChange={(e) => setOutHeight(Number(e.target.value))}>
            {sizes.map((s) => (
              <option key={s.height} value={s.height}>
                {s.label}
                {s.height === height ? ' (project)' : ''}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Quality">
          <Segmented value={quality} options={QUALITIES} onChange={setQuality} />
        </Field>
        <Field label="Encoder" hint={encoders ? undefined : 'Detecting…'}>
          <Select value={encoder} onChange={(e) => setEncoder(e.target.value)}>
            <option value="auto">Automatic{hardware ? ` (${hardware.label})` : ' (software)'}</option>
            {encoders?.map((e) => (
              <option key={e.name} value={e.hardware ? e.name : 'software'}>
                {e.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Audio">
          <Select value={audioBitrate} onChange={(e) => setAudioBitrate(Number(e.target.value))}>
            {[128, 192, 256, 320].map((kbps) => (
              <option key={kbps} value={kbps}>
                AAC {kbps} kbps
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Range">
          <Segmented
            value={range ? 'range' : 'all'}
            options={[
              { value: 'all', label: 'Entire timeline' },
              { value: 'range', label: project.range ? 'In – Out' : 'In – Out (set with I / O)' }
            ]}
            onChange={(v) => setUseRange(v === 'range' && Boolean(project.range))}
          />
        </Field>
        <div className="mt-2 flex items-center justify-between border-t border-line pt-3">
          <span className="text-2xs text-faint">
            {formatTimecode(frames, fps)} · {frames} frames · {Number(fps.toFixed(3))} fps
          </span>
          <Button variant="primary" disabled={frames <= 0} onClick={() => void start()}>
            Export…
          </Button>
        </div>
      </div>
      {jobs.length > 0 && <Queue jobs={jobs} />}
    </Modal>
  )
}

function Queue({ jobs }: { jobs: ExportJobState[] }) {
  return (
    <section className="border-t border-line bg-bg/50 p-4">
      <header className="mb-2 flex items-center justify-between">
        <h3 className="text-2xs font-semibold tracking-wider text-muted uppercase">Queue</h3>
        {jobs.some((j) => ['done', 'error', 'cancelled'].includes(j.state)) && (
          <button
            className="text-2xs text-faint hover:text-fg"
            onClick={() => void window.edion.export.clearFinished()}
          >
            Clear finished
          </button>
        )}
      </header>
      <ul className="flex flex-col gap-1.5">
        {jobs.map((job) => (
          <JobRow key={job.id} job={job} />
        ))}
      </ul>
    </section>
  )
}

function JobRow({ job }: { job: ExportJobState }) {
  const fraction = job.totalFrames > 0 ? job.frame / job.totalFrames : 0
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (job.state !== 'running') return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [job.state])

  let status: string
  if (job.state === 'queued') status = 'Waiting…'
  else if (job.state === 'running') {
    const elapsed = (now - (job.startedAt ?? now)) / 1000
    const remaining = fraction > 0.02 ? (elapsed / fraction) * (1 - fraction) : null
    status =
      job.phase === 'audio'
        ? 'Mixing audio…'
        : job.phase === 'finishing'
          ? 'Finishing…'
          : `${Math.round(fraction * 100)}%${remaining !== null ? ` · ${formatRemaining(remaining)} left` : ''}${job.encoder ? ` · ${job.encoder}` : ''}`
  } else if (job.state === 'done')
    status = `Done in ${formatRemaining(((job.finishedAt ?? 0) - (job.startedAt ?? 0)) / 1000)}`
  else if (job.state === 'cancelled') status = 'Cancelled'
  else status = job.message ?? 'Failed'

  return (
    <li className="rounded-lg border border-line bg-surface px-3 py-2">
      <div className="flex items-center gap-2">
        {job.state === 'done' ? (
          <CheckCircle2 size={14} className="shrink-0 text-ok" />
        ) : job.state === 'error' ? (
          <CircleAlert size={14} className="shrink-0 text-danger" />
        ) : job.state === 'running' ? (
          <Loader2 size={14} className="shrink-0 animate-spin text-accent" />
        ) : (
          <span className="size-3.5 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate text-xs" title={job.outputPath}>
          {job.name}
        </span>
        {job.state === 'done' && (
          <IconButton
            label="Show in folder"
            className="size-6"
            onClick={() => void window.edion.export.reveal(job.outputPath)}
          >
            <FolderSearch size={13} />
          </IconButton>
        )}
        {(job.state === 'running' || job.state === 'queued') && (
          <IconButton
            label="Cancel export"
            className="size-6"
            onClick={() => void window.edion.export.cancel(job.id)}
          >
            <X size={13} />
          </IconButton>
        )}
      </div>
      {job.state === 'running' && (
        <div className="mt-1.5 h-1 overflow-hidden rounded bg-raised">
          <div
            className="h-full bg-accent transition-[width] duration-200"
            style={{ width: `${fraction * 100}%` }}
          />
        </div>
      )}
      <p className={`mt-1 text-2xs select-text ${job.state === 'error' ? 'text-danger' : 'text-faint'}`}>
        {status}
      </p>
    </li>
  )
}

function formatRemaining(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}
