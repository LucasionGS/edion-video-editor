import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  BetweenHorizontalStart,
  Check,
  Copy,
  Ellipsis,
  FileAudio,
  FolderInput,
  FolderSearch,
  Gauge,
  ImageIcon,
  Link2,
  MonitorPlay,
  MousePointerClick,
  Plus,
  Search,
  Trash2,
  Upload
} from 'lucide-react'
import { formatClock, mediaUsage, projectDuration, removeMedia, removeUnusedMedia } from '@core/index'
import type { MediaAsset } from '@core/index'
import type { Filmstrip } from '@shared/ipc'
import { edit, select, useEditor } from '@/store/editor'
import { confirm, toast } from '@/store/feedback'
import {
  addAssetToTimeline,
  collectMedia,
  importMedia,
  importMediaDialog,
  relinkMedia
} from '@/store/projectActions'
import { Button } from '@/ui/Button'
import { openInSource } from '@/store/source'
import { Segmented } from '@/ui/Field'
import { IconButton } from '@/ui/IconButton'
import { EmptyState } from '@/ui/Panel'
import { requestProxy, useProxies } from '@/engine/proxies'
import { openContextMenu, type MenuItem } from '@/ui/ContextMenu'
import { VoiceoverButton } from './Voiceover'

export const MEDIA_DRAG_TYPE = 'application/x-edion-media'

type KindFilter = 'all' | MediaAsset['kind']
const KIND_FILTERS: ReadonlyArray<{ value: KindFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'video', label: 'Video' },
  { value: 'audio', label: 'Audio' },
  { value: 'image', label: 'Images' }
]

export function MediaLibrary() {
  const media = useEditor((s) => s.project.media)
  const missing = useEditor((s) => s.missingMedia)
  const tracks = useEditor((s) => s.project.tracks)
  const usage = useMemo(() => mediaUsage({ tracks }), [tracks])
  const [dropping, setDropping] = useState(false)
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<KindFilter>('all')
  const needle = query.trim().toLowerCase()
  const shown = media.filter(
    (m) => (kind === 'all' || m.kind === kind) && (!needle || m.name.toLowerCase().includes(needle))
  )
  const unused = media.filter((m) => !usage.has(m.id)).length

  function openLibraryMenu(event: React.MouseEvent): void {
    openContextMenu(event, [
      { label: 'Import media…', icon: <Upload size={13} />, onSelect: () => void importMediaDialog() },
      { type: 'separator' },
      {
        label: unused ? `Remove ${unused} unused item${unused > 1 ? 's' : ''}` : 'No unused media',
        icon: <Trash2 size={13} />,
        disabled: unused === 0,
        onSelect: () => {
          let count = 0
          edit('Remove unused media', (draft) => void (count = removeUnusedMedia(draft)))
          toast(`Removed ${count} unused item${count > 1 ? 's' : ''}.`)
        }
      },
      {
        label: 'Collect files into a folder…',
        icon: <FolderInput size={13} />,
        disabled: media.length === 0,
        onSelect: () => void collectMedia()
      }
    ])
  }

  return (
    <div
      className={`flex h-full flex-col ${dropping ? 'bg-accent-soft' : ''}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setDropping(true)
      }}
      onDragLeave={() => setDropping(false)}
      onContextMenu={openLibraryMenu}
      onDrop={(e) => {
        e.preventDefault()
        setDropping(false)
        void importMedia([...e.dataTransfer.files].map((f) => window.edion.media.pathForFile(f)))
      }}
    >
      <div className="flex shrink-0 items-center justify-between px-3 py-2">
        <span className="truncate text-2xs whitespace-nowrap text-faint">
          {media.length > 0 ? `${media.length} item${media.length > 1 ? 's' : ''}` : ''}
        </span>
        <span className="flex gap-1.5">
          <VoiceoverButton />
          <Button onClick={() => void importMediaDialog()}>
            <Upload size={13} /> Import
          </Button>
          <IconButton label="More" onClick={openLibraryMenu}>
            <Ellipsis size={15} />
          </IconButton>
        </span>
      </div>
      {media.length > 0 && (
        <div className="flex shrink-0 flex-col gap-1.5 px-3 pb-2">
          <label className="flex h-7 items-center gap-1.5 rounded-md border border-line bg-bg px-2 focus-within:border-accent">
            <Search size={12} className="shrink-0 text-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Escape') setQuery('')
              }}
              placeholder="Search media"
              aria-label="Search media"
              className="min-w-0 flex-1 bg-transparent text-xs outline-none select-text placeholder:text-faint"
            />
          </label>
          <Segmented value={kind} options={KIND_FILTERS} onChange={setKind} />
        </div>
      )}
      {media.length === 0 ? (
        <EmptyState
          icon={<Upload size={22} />}
          title="Import media"
          hint="Drop video, audio or image files here, or use the Import button."
        />
      ) : (
        <ul className="grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2 overflow-auto px-3 pb-3">
          {shown.map((asset) => (
            <MediaCard
              key={asset.id}
              asset={asset}
              missing={missing.includes(asset.id)}
              uses={usage.get(asset.id) ?? 0}
            />
          ))}
          {shown.length === 0 && (
            <li className="col-span-full py-6 text-center text-2xs text-faint">Nothing matches.</li>
          )}
        </ul>
      )}
    </div>
  )
}

function MediaCard({ asset, missing, uses }: { asset: MediaAsset; missing: boolean; uses: number }) {
  const thumbnail = useThumbnail(asset, missing)
  const proxy = useProxies((s) => s.byPath[asset.path])

  async function remove(): Promise<void> {
    const used = useEditor
      .getState()
      .project.tracks.some((t) => t.clips.some((c) => 'mediaId' in c && c.mediaId === asset.id))
    if (used) {
      const answer = await confirm({
        title: 'Remove media?',
        message: `“${asset.name}” is used on the timeline. Removing it also removes those clips.`,
        confirmLabel: 'Remove',
        danger: true
      })
      if (answer !== 'confirm') return
    }
    edit('Remove media', (draft) => removeMedia(draft, asset.id))
  }

  function openMenu(event: React.MouseEvent): void {
    event.stopPropagation()
    const { project } = useEditor.getState()
    const uses = project.tracks.flatMap((t) =>
      t.clips.filter((c) => 'mediaId' in c && c.mediaId === asset.id).map((c) => c.id)
    )
    const items: MenuItem[] = [
      {
        label: 'Add at playhead',
        icon: <Plus size={13} />,
        disabled: missing,
        onSelect: () => addAssetToTimeline(asset)
      },
      {
        label: 'Open in source monitor',
        icon: <MonitorPlay size={13} />,
        disabled: missing,
        onSelect: () => openInSource(asset.id)
      },
      {
        label: 'Insert at playhead',
        icon: <BetweenHorizontalStart size={13} />,
        disabled: missing,
        onSelect: () => addAssetToTimeline(asset, undefined, undefined, 'insert')
      },
      {
        label: 'Overwrite at playhead',
        disabled: missing,
        onSelect: () => addAssetToTimeline(asset, undefined, undefined, 'overwrite')
      },
      {
        label: 'Add at end of timeline',
        disabled: missing,
        onSelect: () => addAssetToTimeline(asset, projectDuration(project))
      },
      { type: 'separator' },
      {
        label: uses.length
          ? `Select ${uses.length} clip${uses.length > 1 ? 's' : ''} using this`
          : 'Not used on the timeline',
        icon: <MousePointerClick size={13} />,
        disabled: uses.length === 0,
        onSelect: () => select(uses)
      },
      {
        label: 'Show in folder',
        icon: <FolderSearch size={13} />,
        disabled: missing,
        onSelect: () => void window.edion.export.reveal(asset.path)
      },
      {
        label: 'Copy file path',
        icon: <Copy size={13} />,
        onSelect: () => {
          window.edion.copyText(asset.path)
          toast('Path copied')
        }
      },
      {
        label: missing ? 'Locate missing file…' : 'Replace file…',
        icon: <Link2 size={13} />,
        onSelect: () => void relinkMedia(asset.id)
      }
    ]
    if (asset.kind === 'video' && !missing) {
      items.push({
        label:
          proxy === 'pending'
            ? 'Creating preview proxy…'
            : typeof proxy === 'object'
              ? 'Preview proxy ready'
              : 'Create preview proxy',
        icon: <Gauge size={13} />,
        disabled: proxy === 'pending' || typeof proxy === 'object',
        onSelect: () => {
          toast('Creating a lightweight preview copy in the background…')
          void requestProxy(asset.path).then((path) =>
            toast(
              path ? `Proxy ready for “${asset.name}”` : 'Proxy creation failed',
              path ? 'success' : 'error'
            )
          )
        }
      })
    }
    items.push(
      { type: 'separator' },
      {
        label: 'Remove from project',
        icon: <Trash2 size={13} />,
        danger: true,
        onSelect: () => void remove()
      }
    )
    openContextMenu(event, items)
  }

  return (
    <li
      onContextMenu={openMenu}
      className="group relative cursor-grab overflow-hidden rounded-md border border-line bg-raised active:cursor-grabbing"
      draggable={!missing}
      onDragStart={(e) => {
        e.dataTransfer.setData(MEDIA_DRAG_TYPE, asset.id)
        e.dataTransfer.effectAllowed = 'copy'
      }}
      onDoubleClick={() => !missing && addAssetToTimeline(asset)}
      title={missing ? `Missing: ${asset.path}` : asset.path}
    >
      <div className="relative flex aspect-video items-center justify-center overflow-hidden bg-bg">
        {missing ? (
          <AlertTriangle size={20} className="text-danger" />
        ) : thumbnail ? (
          <div className="size-full bg-cover bg-center" style={thumbnail} />
        ) : asset.kind === 'audio' ? (
          <FileAudio size={20} className="text-clip-audio" />
        ) : (
          <ImageIcon size={20} className="text-faint" />
        )}
        {proxy && (
          <span
            className="absolute top-1 left-1 rounded bg-black/70 px-1 text-[9px] font-medium tracking-wide text-white uppercase"
            title={
              proxy === 'pending'
                ? 'Creating a lightweight preview copy…'
                : proxy === 'failed'
                  ? 'Proxy creation failed; using the original'
                  : 'Previewing from a lightweight proxy. Exports always use the original.'
            }
          >
            {proxy === 'pending' ? 'Proxy…' : proxy === 'failed' ? 'No proxy' : 'Proxy'}
          </span>
        )}
        {uses > 0 && (
          <span
            className="absolute top-1 right-1 flex items-center gap-0.5 rounded bg-black/70 px-1 text-[9px] font-medium text-white"
            title={`Used by ${uses} clip${uses > 1 ? 's' : ''} on the timeline`}
          >
            <Check size={9} />
            {uses > 1 ? uses : ''}
          </span>
        )}
        {asset.duration > 0 && (
          <span className="absolute right-1 bottom-1 rounded bg-black/70 px-1 font-mono text-[10px] text-white">
            {formatClock(asset.duration)}
          </span>
        )}
        <div className="absolute inset-0 hidden items-center justify-center gap-1 bg-black/55 group-hover:flex">
          {missing ? (
            <Button variant="primary" onClick={() => void relinkMedia(asset.id)}>
              Relink
            </Button>
          ) : (
            <button
              className="flex size-7 items-center justify-center rounded-full bg-accent text-white hover:bg-accent-hover"
              title="Add to timeline"
              aria-label="Add to timeline"
              onClick={() => addAssetToTimeline(asset)}
            >
              <Plus size={15} />
            </button>
          )}
          <button
            className="flex size-7 items-center justify-center rounded-full bg-raised text-muted hover:text-danger"
            title="Remove from project"
            aria-label="Remove from project"
            onClick={() => void remove()}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
      <p className="truncate px-1.5 py-1 text-2xs text-muted">{asset.name}</p>
    </li>
  )
}

function useThumbnail(asset: MediaAsset, missing: boolean): React.CSSProperties | null {
  const [style, setStyle] = useState<React.CSSProperties | null>(null)
  useEffect(() => {
    if (missing) return setStyle(null)
    let cancelled = false
    const apply = (next: React.CSSProperties | null): void => void (!cancelled && setStyle(next))
    if (asset.kind === 'image') {
      void window.edion.library.fileUrl(asset.path).then((url) => apply({ backgroundImage: `url("${url}")` }))
    } else if (asset.kind === 'video') {
      void window.edion.library
        .filmstrip(asset.path)
        .then((strip) => apply(strip && filmstripTile(strip, Math.floor(strip.count / 4))))
    }
    return () => void (cancelled = true)
  }, [asset.path, asset.kind, missing])
  return style
}

/** CSS that shows tile `index` of a filmstrip sprite, filling the element. */
export function filmstripTile(strip: Filmstrip, index: number): React.CSSProperties {
  const position = strip.count > 1 ? (index / (strip.count - 1)) * 100 : 0
  return {
    backgroundImage: `url("${strip.url}")`,
    backgroundSize: `${strip.count * 100}% 100%`,
    backgroundPosition: `${position}% 0`
  }
}
