import { useEffect, useState } from 'react'
import { AlertTriangle, FileAudio, ImageIcon, Plus, Trash2, Upload } from 'lucide-react'
import { formatClock, removeMedia } from '@core/index'
import type { MediaAsset } from '@core/index'
import type { Filmstrip } from '@shared/ipc'
import { edit, useEditor } from '@/store/editor'
import { confirm } from '@/store/feedback'
import { addAssetToTimeline, importMedia, importMediaDialog, relinkMedia } from '@/store/projectActions'
import { Button } from '@/ui/Button'
import { EmptyState } from '@/ui/Panel'
import { useProxies } from '@/engine/proxies'
import { VoiceoverButton } from './Voiceover'

export const MEDIA_DRAG_TYPE = 'application/x-edion-media'

export function MediaLibrary() {
  const media = useEditor((s) => s.project.media)
  const missing = useEditor((s) => s.missingMedia)
  const [dropping, setDropping] = useState(false)

  return (
    <div
      className={`flex h-full flex-col ${dropping ? 'bg-accent-soft' : ''}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setDropping(true)
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDropping(false)
        void importMedia([...e.dataTransfer.files].map((f) => window.edion.media.pathForFile(f)))
      }}
    >
      <div className="flex shrink-0 items-center justify-between px-3 py-2">
        <span className="text-2xs text-faint">
          {media.length > 0 ? `${media.length} item${media.length > 1 ? 's' : ''}` : ''}
        </span>
        <span className="flex gap-1.5">
          <VoiceoverButton />
          <Button onClick={() => void importMediaDialog()}>
            <Upload size={13} /> Import
          </Button>
        </span>
      </div>
      {media.length === 0 ? (
        <EmptyState
          icon={<Upload size={22} />}
          title="Import media"
          hint="Drop video, audio or image files here, or use the Import button."
        />
      ) : (
        <ul className="grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2 overflow-auto px-3 pb-3">
          {media.map((asset) => (
            <MediaCard key={asset.id} asset={asset} missing={missing.includes(asset.id)} />
          ))}
        </ul>
      )}
    </div>
  )
}

function MediaCard({ asset, missing }: { asset: MediaAsset; missing: boolean }) {
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

  return (
    <li
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
