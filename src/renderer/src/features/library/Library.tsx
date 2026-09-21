import { useState } from 'react'
import { Blend, Captions, FolderOpen, Type } from 'lucide-react'
import { CaptionsLibrary } from './CaptionsLibrary'
import { MediaLibrary } from './MediaLibrary'
import { TitlesLibrary } from './TitlesLibrary'
import { TransitionsLibrary } from './TransitionsLibrary'

const TABS = [
  { id: 'media', label: 'Media', Icon: FolderOpen, Panel: MediaLibrary },
  { id: 'titles', label: 'Text', Icon: Type, Panel: TitlesLibrary },
  { id: 'transitions', label: 'Transitions', Icon: Blend, Panel: TransitionsLibrary },
  { id: 'captions', label: 'Captions', Icon: Captions, Panel: CaptionsLibrary }
] as const

export function Library() {
  const [active, setActive] = useState<(typeof TABS)[number]['id']>('media')
  const Panel = TABS.find((t) => t.id === active)!.Panel
  return (
    <section className="@container flex h-full min-h-0 min-w-0 flex-col bg-surface">
      <nav className="flex h-9 shrink-0 items-stretch border-b border-line px-1" role="tablist">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            role="tab"
            aria-selected={active === id}
            title={label}
            onClick={() => setActive(id)}
            className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 border-b-2 px-1 text-xs transition-colors ${
              active === id ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg'
            }`}
          >
            <Icon size={14} className="shrink-0" />
            <span className="truncate @max-[260px]:hidden">{label}</span>
          </button>
        ))}
      </nav>
      <div className="min-h-0 flex-1" role="tabpanel">
        <Panel />
      </div>
    </section>
  )
}
