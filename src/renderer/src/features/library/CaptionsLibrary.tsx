import { Download, Plus, Trash2, Upload } from 'lucide-react'
import {
  addTrack,
  clipsToCues,
  createCaptionClip,
  cuesToClips,
  deleteClips,
  formatPosition,
  insertClip,
  isFree,
  parseSubtitles,
  serializeSrt,
  serializeVtt
} from '@core/index'
import type { CaptionClip } from '@core/index'
import { seek } from '@/engine/playback/session'
import { edit, select, useEditor } from '@/store/editor'
import { editClips } from '@/store/clipEdits'
import { toast } from '@/store/feedback'
import { useShallow } from 'zustand/react/shallow'
import { Button } from '@/ui/Button'
import { EmptyState } from '@/ui/Panel'

const captionClips = (s: ReturnType<typeof useEditor.getState>): CaptionClip[] =>
  s.project.tracks.flatMap((t) =>
    t.kind === 'caption' ? t.clips.filter((c): c is CaptionClip => c.type === 'caption') : []
  )

async function importSubtitles(): Promise<void> {
  const file = await window.edion.dialog.openText(['srt', 'vtt'])
  if (!file) return
  const cues = parseSubtitles(file.content)
  if (cues.length === 0) return toast('No captions found in that file', 'error')
  let skipped = 0
  edit('Import captions', (draft) => {
    // Imported captions get their own track so they never fight with existing ones.
    const track = addTrack(draft, 'caption')
    for (const clip of cuesToClips(cues, draft.settings.fps))
      if (!insertClip(draft, track.id, clip)) skipped++
  })
  toast(`Imported ${cues.length - skipped} captions`, 'success')
}

async function exportSubtitles(format: 'srt' | 'vtt'): Promise<void> {
  const { project } = useEditor.getState()
  const cues = clipsToCues(captionClips(useEditor.getState()), project.settings.fps)
  const saved = await window.edion.dialog.saveText(
    `${project.name}.${format}`,
    [format],
    format === 'srt' ? serializeSrt(cues) : serializeVtt(cues)
  )
  if (saved) toast(`Saved ${cues.length} captions`, 'success')
}

function addCaption(): void {
  const { playhead } = useEditor.getState()
  let id: string | null = null
  edit('Add caption', (draft) => {
    const clip = createCaptionClip(playhead, Math.round(draft.settings.fps * 2.5), 'New caption')
    const track =
      draft.tracks.find((t) => t.kind === 'caption' && !t.locked && isFree(t, clip.start, clip.duration)) ??
      addTrack(draft, 'caption')
    if (insertClip(draft, track.id, clip)) id = clip.id
  })
  if (id) select([id])
}

export function CaptionsLibrary() {
  const clips = [...useEditor(useShallow(captionClips))].sort((a, b) => a.start - b.start)
  const fps = useEditor((s) => s.project.settings.fps)
  const selection = useEditor((s) => s.selection)
  const display = useEditor((s) => s.timeDisplay)

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-3 py-2">
        <Button onClick={addCaption}>
          <Plus size={13} /> Add
        </Button>
        <Button onClick={() => void importSubtitles()}>
          <Upload size={13} /> Import SRT/VTT
        </Button>
        <Button
          disabled={clips.length === 0}
          onClick={() => void exportSubtitles('srt')}
          title="Export as .srt (captions are also burned into exported video)"
        >
          <Download size={13} /> SRT
        </Button>
        <Button disabled={clips.length === 0} onClick={() => void exportSubtitles('vtt')}>
          <Download size={13} /> VTT
        </Button>
      </div>
      {clips.length === 0 ? (
        <EmptyState
          icon={<Upload size={22} />}
          title="No captions yet"
          hint="Add captions at the playhead or import a subtitle file. Captions are burned into the exported video; hide the caption track to leave them out."
        />
      ) : (
        <ul className="min-h-0 flex-1 overflow-auto px-3 pb-3">
          {clips.map((clip) => (
            <li
              key={clip.id}
              className={`group mb-1 flex gap-2 rounded-md border px-2 py-1.5 ${selection.includes(clip.id) ? 'border-accent bg-accent-soft' : 'border-line bg-raised'}`}
              onClick={() => {
                select([clip.id])
                seek(clip.start)
              }}
            >
              <span className="shrink-0 pt-0.5 font-mono text-[10px] text-faint">
                {formatPosition(clip.start, fps, display)}
              </span>
              <textarea
                aria-label="Caption text"
                rows={Math.max(1, clip.text.split('\n').length)}
                value={clip.text}
                onKeyDown={(e) => e.stopPropagation()}
                onChange={(e) =>
                  editClips(
                    [clip.id],
                    'Edit caption',
                    (c) => c.type === 'caption' && void (c.text = e.target.value)
                  )
                }
                className="min-w-0 flex-1 resize-none bg-transparent text-xs leading-snug outline-none select-text"
              />
              <button
                aria-label="Delete caption"
                className="hidden shrink-0 self-start text-faint group-hover:block hover:text-danger"
                onClick={(e) => {
                  e.stopPropagation()
                  edit('Delete caption', (d) => deleteClips(d, [clip.id]))
                }}
              >
                <Trash2 size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
