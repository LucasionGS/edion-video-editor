import { useEffect, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { COMMANDS, comboOf, formatCombo, keysFor, useShortcutState, type Command } from '@/app/shortcuts'
import { toast } from '@/store/feedback'

const MODIFIERS = new Set(['control', 'shift', 'alt', 'meta'])

export function ShortcutsEditor() {
  const overrides = useShortcutState((s) => s.overrides)
  const [recording, setRecording] = useState<string | null>(null)

  const save = (next: Record<string, string[]>): void => {
    useShortcutState.setState({ overrides: next })
    void window.edion.settings.update({ shortcuts: next })
  }

  // While recording, the next non-modifier key press becomes the binding.
  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (MODIFIERS.has(e.key.toLowerCase())) return
      setRecording(null)
      if (e.key === 'Escape') return
      const combo = comboOf(e)
      const clash = COMMANDS.find((c) => c.id !== recording && keysFor(c, overrides).includes(combo))
      if (clash) return toast(`${formatCombo(combo)} is already used by “${clash.label}”`, 'error')
      save({ ...overrides, [recording]: [combo] })
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording, overrides]) // eslint-disable-line react-hooks/exhaustive-deps

  const groups = [...new Set(COMMANDS.map((c) => c.group))]
  const row = (command: Command) => (
    <li key={command.id} className="flex h-7 items-center gap-2">
      <span className="flex-1 truncate text-xs text-muted">{command.label}</span>
      <button
        className={`h-6 min-w-24 rounded border px-2 font-mono text-2xs ${
          recording === command.id
            ? 'border-accent bg-accent-soft text-accent'
            : 'border-line bg-raised text-fg hover:border-faint'
        }`}
        onClick={() => setRecording(recording === command.id ? null : command.id)}
        title="Click, then press the new shortcut (Esc cancels)"
      >
        {recording === command.id
          ? 'Press keys…'
          : keysFor(command, overrides).map(formatCombo).join('  ·  ')}
      </button>
      <button
        aria-label={`Reset ${command.label}`}
        title="Reset to default"
        disabled={!overrides[command.id]}
        className="text-faint hover:text-fg disabled:invisible"
        onClick={() => {
          const { [command.id]: _removed, ...rest } = overrides
          save(rest)
        }}
      >
        <RotateCcw size={12} />
      </button>
    </li>
  )

  return (
    <div className="flex flex-col gap-3 p-4">
      {groups.map((group) => (
        <section key={group}>
          <h3 className="mb-1 text-2xs font-semibold tracking-wider text-faint uppercase">{group}</h3>
          <ul>{COMMANDS.filter((c) => c.group === group).map(row)}</ul>
        </section>
      ))}
    </div>
  )
}
