import { History as HistoryIcon } from 'lucide-react'
import { historySteps, jumpHistory, useEditor } from '@/store/editor'
import { EmptyState } from '@/ui/Panel'

/** Every undoable step; clicking one goes back (or forward) to right after it. */
export function HistoryPanel() {
  // Re-render on every change of the document.
  useEditor((s) => s.revision)
  const { undo, redo } = historySteps()
  if (undo.length === 0 && redo.length === 0)
    return (
      <EmptyState
        icon={<HistoryIcon size={22} />}
        title="No history yet"
        hint="Every edit you make shows up here."
      />
    )
  const row = (label: string, key: string, steps: number, state: 'done' | 'current' | 'undone') => (
    <li key={key}>
      <button
        type="button"
        onClick={() => steps !== 0 && jumpHistory(steps)}
        className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs ${
          state === 'current'
            ? 'bg-accent-soft text-fg'
            : state === 'undone'
              ? 'text-faint italic hover:bg-hover'
              : 'text-muted hover:bg-hover hover:text-fg'
        }`}
      >
        <span className="size-1.5 shrink-0 rounded-full bg-current opacity-60" />
        <span className="truncate">{label}</span>
      </button>
    </li>
  )
  return (
    <ol className="flex h-full flex-col gap-px overflow-auto p-2">
      {row('Opened project', 'origin', -undo.length, undo.length === 0 ? 'current' : 'done')}
      {undo.map((label, i) =>
        row(label, `u${i}`, i + 1 - undo.length, i === undo.length - 1 ? 'current' : 'done')
      )}
      {redo.map((label, i) => row(label, `r${i}`, i + 1, 'undone'))}
    </ol>
  )
}
