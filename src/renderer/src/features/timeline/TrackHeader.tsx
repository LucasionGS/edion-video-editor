import { useState } from 'react'
import { Captions, Eye, EyeOff, Film, Lock, LockOpen, Music, Trash2, Volume2, VolumeX } from 'lucide-react'
import { removeTrack } from '@core/index'
import type { Track } from '@core/index'
import { edit } from '@/store/editor'
import { confirm } from '@/store/feedback'
import { IconButton } from '@/ui/IconButton'
import { HEADER_WIDTH } from './view'

const kindIcon = { video: Film, audio: Music, caption: Captions }

export function TrackHeader({ track }: { track: Track }) {
  const [renaming, setRenaming] = useState(false)
  const Icon = kindIcon[track.kind]
  const patch = (label: string, change: Partial<Track>): void =>
    edit(label, (draft) => {
      const target = draft.tracks.find((t) => t.id === track.id)
      if (target) Object.assign(target, change)
    })

  async function remove(): Promise<void> {
    if (track.clips.length > 0) {
      const answer = await confirm({
        title: `Delete “${track.name}”?`,
        message: `The ${track.clips.length} clip${track.clips.length > 1 ? 's' : ''} on this track will be deleted too.`,
        confirmLabel: 'Delete track',
        danger: true
      })
      if (answer !== 'confirm') return
    }
    edit('Delete track', (draft) => removeTrack(draft, track.id))
  }

  return (
    <div
      className="group sticky left-0 z-20 flex shrink-0 items-center gap-1 border-r border-b border-line bg-surface pr-1 pl-2.5"
      style={{ width: HEADER_WIDTH, height: track.height }}
    >
      <Icon size={13} className="shrink-0 text-faint" />
      {renaming ? (
        <input
          autoFocus
          defaultValue={track.name}
          className="min-w-0 flex-1 rounded bg-bg px-1 text-xs outline-none ring-1 ring-accent select-text"
          onBlur={(e) => {
            setRenaming(false)
            const name = e.target.value.trim()
            if (name && name !== track.name) patch('Rename track', { name })
          }}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur()
          }}
        />
      ) : (
        <span
          className="min-w-0 flex-1 truncate text-xs text-muted"
          onDoubleClick={() => setRenaming(true)}
          title="Double-click to rename"
        >
          {track.name}
        </span>
      )}
      <span className="hidden group-hover:block">
        <IconButton label="Delete track" className="size-6 hover:text-danger" onClick={() => void remove()}>
          <Trash2 size={12} />
        </IconButton>
      </span>
      {track.kind !== 'audio' && (
        <IconButton
          label={track.hidden ? 'Show track' : 'Hide track'}
          active={track.hidden}
          className="size-6"
          onClick={() => patch('Toggle track visibility', { hidden: !track.hidden })}
        >
          {track.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
        </IconButton>
      )}
      {track.kind !== 'caption' && (
        <IconButton
          label={track.muted ? 'Unmute track' : 'Mute track'}
          active={track.muted}
          className="size-6"
          onClick={() => patch('Toggle track mute', { muted: !track.muted })}
        >
          {track.muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
        </IconButton>
      )}
      {track.kind === 'audio' && (
        <IconButton
          label="Solo"
          active={track.solo}
          className="size-6 text-[10px] font-bold"
          onClick={() => patch('Toggle solo', { solo: !track.solo })}
        >
          S
        </IconButton>
      )}
      <IconButton
        label={track.locked ? 'Unlock track' : 'Lock track'}
        active={track.locked}
        className="size-6"
        onClick={() => patch('Toggle track lock', { locked: !track.locked })}
      >
        {track.locked ? <Lock size={13} /> : <LockOpen size={13} />}
      </IconButton>
    </div>
  )
}
