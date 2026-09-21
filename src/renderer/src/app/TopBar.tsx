import { useState } from 'react'
import { Download, Film, FilePlus2, FolderOpen, Loader2, Save, Settings } from 'lucide-react'
import { activeJob, useExports } from '@/store/exports'
import { edit, isDirty, useEditor } from '@/store/editor'
import { newProject, openProject, saveProject } from '@/store/projectActions'
import { Button } from '@/ui/Button'
import { IconButton } from '@/ui/IconButton'

export function TopBar({ onExport, onSettings }: { onExport: () => void; onSettings: () => void }) {
  const name = useEditor((s) => s.project.name)
  const dirty = useEditor((s) => isDirty(s))
  const settings = useEditor((s) => s.project.settings)
  const [renaming, setRenaming] = useState(false)

  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-surface px-3">
      <Film size={16} className="text-accent" />
      <span className="mr-2 text-sm font-semibold tracking-tight">Edion</span>
      <IconButton label="New project (Ctrl+N)" onClick={() => void newProject()}>
        <FilePlus2 size={15} />
      </IconButton>
      <IconButton label="Open project (Ctrl+O)" onClick={() => void openProject()}>
        <FolderOpen size={15} />
      </IconButton>
      <IconButton label="Save (Ctrl+S)" onClick={() => void saveProject()}>
        <Save size={15} />
      </IconButton>

      <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
        {renaming ? (
          <input
            autoFocus
            defaultValue={name}
            className="w-64 rounded bg-bg px-2 py-0.5 text-center text-xs outline-none ring-1 ring-accent select-text"
            onBlur={(e) => {
              setRenaming(false)
              const next = e.target.value.trim()
              if (next && next !== name) edit('Rename project', (d) => void (d.name = next))
            }}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === 'Escape') && e.currentTarget.blur()}
          />
        ) : (
          <button
            className="max-w-72 truncate rounded px-2 py-0.5 text-xs text-fg hover:bg-hover"
            onDoubleClick={() => setRenaming(true)}
            title="Double-click to rename"
          >
            {name}
          </button>
        )}
        <span
          className={`size-1.5 rounded-full ${dirty ? 'bg-clip-text' : 'bg-transparent'}`}
          title={dirty ? 'Unsaved changes' : undefined}
        />
        <span className="hidden text-2xs text-faint md:inline">
          {settings.width}×{settings.height} · {Number(settings.fps.toFixed(3))} fps
        </span>
      </div>

      <ExportIndicator onClick={onExport} />
      <IconButton label="Settings" onClick={onSettings}>
        <Settings size={15} />
      </IconButton>
      <Button variant="primary" onClick={onExport}>
        <Download size={14} /> Export
      </Button>
    </header>
  )
}

/** Compact progress of the running export; click to open the queue. */
function ExportIndicator({ onClick }: { onClick: () => void }) {
  const job = useExports((s) => activeJob(s.jobs))
  if (!job) return null
  const percent = job.totalFrames > 0 ? Math.round((job.frame / job.totalFrames) * 100) : 0
  return (
    <button
      className="flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted hover:bg-hover hover:text-fg"
      onClick={onClick}
      title={`Exporting ${job.name}`}
    >
      <Loader2 size={13} className="animate-spin text-accent" />
      <span className="font-mono tabular-nums">{job.phase === 'audio' ? 'Audio…' : `${percent}%`}</span>
    </button>
  )
}
