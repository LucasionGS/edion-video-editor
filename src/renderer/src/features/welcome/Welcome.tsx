import { useEffect, useState } from 'react'
import { FilePlus2, FolderOpen, History, Upload } from 'lucide-react'
import type { AutosaveInfo, RecentProject } from '@shared/ipc'
import { isDirty, useEditor } from '@/store/editor'
import { importMediaDialog, openProject, recoverAutosave } from '@/store/projectActions'
import { Button } from '@/ui/Button'

const ago = (time: number): string => {
  const minutes = Math.round((Date.now() - time) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h ago`
  return new Date(time).toLocaleDateString()
}

/** Start screen shown over an untouched project: recover, reopen, or begin. */
export function Welcome() {
  const pristine = useEditor((s) => s.path === null && !isDirty(s) && s.project.media.length === 0)
  const [dismissed, setDismissed] = useState(false)
  const [recents, setRecents] = useState<RecentProject[]>([])
  const [autosaves, setAutosaves] = useState<AutosaveInfo[]>([])

  useEffect(() => {
    void window.edion.settings.get().then((s) => setRecents(s.recents))
    void window.edion.project.listAutosaves().then(setAutosaves)
  }, [])

  if (!pristine || dismissed) return null
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-bg/80 p-6 backdrop-blur-sm">
      <div className="w-[560px] max-w-full rounded-2xl border border-line bg-surface p-6 shadow-2xl shadow-black/60">
        <h1 className="text-lg font-semibold tracking-tight">Welcome to Edion</h1>
        <p className="mt-1 text-xs text-muted">Start a project, or pick up where you left off.</p>

        <div className="mt-5 grid grid-cols-3 gap-2">
          <Button variant="primary" className="h-9 justify-center" onClick={() => setDismissed(true)}>
            <FilePlus2 size={14} /> New project
          </Button>
          <Button className="h-9 justify-center" onClick={() => void openProject()}>
            <FolderOpen size={14} /> Open…
          </Button>
          <Button className="h-9 justify-center" onClick={() => void importMediaDialog()}>
            <Upload size={14} /> Import media
          </Button>
        </div>

        {autosaves.length > 0 && (
          <section className="mt-5">
            <h2 className="mb-1.5 text-2xs font-semibold tracking-wider text-clip-text uppercase">
              Unsaved work found
            </h2>
            <ul className="flex flex-col gap-1">
              {autosaves.slice(0, 3).map((a) => (
                <li
                  key={a.projectId}
                  className="flex items-center gap-2 rounded-lg border border-line bg-raised px-3 py-2"
                >
                  <History size={14} className="shrink-0 text-clip-text" />
                  <span className="min-w-0 flex-1 truncate text-xs">{a.name}</span>
                  <span className="text-2xs text-faint">{ago(a.savedAt)}</span>
                  <Button onClick={() => void recoverAutosave(a.projectId, a.originalPath)}>Recover</Button>
                  <button
                    className="text-2xs text-faint hover:text-danger"
                    onClick={() => {
                      void window.edion.project.clearAutosave(a.projectId)
                      setAutosaves((list) => list.filter((x) => x.projectId !== a.projectId))
                    }}
                  >
                    Discard
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {recents.length > 0 && (
          <section className="mt-5">
            <h2 className="mb-1.5 text-2xs font-semibold tracking-wider text-faint uppercase">
              Recent projects
            </h2>
            <ul className="flex max-h-48 flex-col overflow-auto">
              {recents.map((r) => (
                <li key={r.path}>
                  <button
                    className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-hover"
                    onClick={() => void openProject(r.path)}
                    title={r.path}
                  >
                    <span className="min-w-0 flex-1 truncate text-xs">{r.name}</span>
                    <span className="max-w-56 truncate text-2xs text-faint">{r.path}</span>
                    <span className="shrink-0 text-2xs text-faint">{ago(r.openedAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        <p className="mt-5 text-2xs text-faint">
          Tip: drop video, audio or images anywhere on the timeline to start editing.
        </p>
      </div>
    </div>
  )
}
