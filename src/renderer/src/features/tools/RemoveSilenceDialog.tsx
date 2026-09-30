import { useState } from 'react'
import { AudioLines, Loader2 } from 'lucide-react'
import {
  DEFAULT_SILENCE_OPTIONS,
  findClip,
  findMedia,
  padSilences,
  removeSourceRanges,
  sourceSpan
} from '@core/index'
import type { Id, SilenceOptions } from '@core/index'
import { closeDialog } from '@/store/dialogs'
import { edit, useEditor } from '@/store/editor'
import { toast } from '@/store/feedback'
import { Button } from '@/ui/Button'
import { Field } from '@/ui/Field'
import { Modal } from '@/ui/Modal'
import { NumberInput } from '@/ui/NumberInput'

/** Remembered for the session, so the next clip starts with the settings that worked. */
let lastOptions = DEFAULT_SILENCE_OPTIONS

/** Finds the pauses in a clip's sound and cuts them out, closing the gaps (jump cuts). */
export function RemoveSilenceDialog({ clipId }: { clipId: Id }) {
  const clip = useEditor((s) => findClip(s.project, clipId)?.clip)
  const fps = useEditor((s) => s.project.settings.fps)
  const [options, setOptions] = useState<SilenceOptions>(lastOptions)
  const [found, setFound] = useState<Array<[number, number]> | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (patch: Partial<SilenceOptions>): void => {
    setOptions((o) => ({ ...o, ...patch }))
    setFound(null)
  }

  if (!clip || !('sourceIn' in clip)) return null
  const timed = clip

  async function analyze(): Promise<Array<[number, number]> | null> {
    const { project } = useEditor.getState()
    const media = findMedia(project, timed.mediaId)
    if (!media?.hasAudio) {
      toast('This clip has no sound to analyse.', 'error')
      return null
    }
    setBusy(true)
    try {
      const raw = await window.edion.library.silences(
        media.path,
        timed.sourceIn,
        sourceSpan(timed, project.settings.fps),
        options.thresholdDb,
        options.minSeconds
      )
      const ranges = padSilences(raw, options.paddingSeconds)
      setFound(ranges)
      lastOptions = options
      return ranges
    } finally {
      setBusy(false)
    }
  }

  async function apply(): Promise<void> {
    const ranges = found ?? (await analyze())
    if (!ranges) return
    if (ranges.length === 0) return toast('No pauses found with these settings.')
    let removed = 0
    edit('Remove silence', (draft) => void (removed = removeSourceRanges(draft, clipId, ranges)))
    closeDialog()
    toast(
      `Removed ${ranges.length} pause${ranges.length > 1 ? 's' : ''} (${(removed / fps).toFixed(1)} s).`,
      'success'
    )
  }

  const total = found?.reduce((sum, [a, b]) => sum + (b - a) / timed.speed, 0) ?? 0
  return (
    <Modal title="Remove silence" onClose={closeDialog} width={420}>
      <div className="flex flex-col gap-2.5 p-4">
        <p className="text-xs text-muted">
          Cuts the pauses out of “{clip.name}” and closes the gaps. Linked clips are cut with it.
        </p>
        <Field label="Quieter than" hint="dB">
          <NumberInput
            label="Silence threshold"
            value={options.thresholdDb}
            min={-80}
            max={-10}
            step={1}
            precision={0}
            onChange={(v) => set({ thresholdDb: v })}
          />
        </Field>
        <Field label="Longer than" hint="seconds">
          <NumberInput
            label="Minimum pause"
            value={options.minSeconds}
            min={0.1}
            max={10}
            step={0.05}
            precision={2}
            onChange={(v) => set({ minSeconds: v })}
          />
        </Field>
        <Field label="Keep around speech" hint="seconds">
          <NumberInput
            label="Padding"
            value={options.paddingSeconds}
            min={0}
            max={1}
            step={0.01}
            precision={2}
            onChange={(v) => set({ paddingSeconds: v })}
          />
        </Field>
        <div className="mt-2 flex items-center justify-between gap-2 border-t border-line pt-3">
          <span className="text-2xs text-faint">
            {busy
              ? 'Listening…'
              : found
                ? `${found.length} pause${found.length === 1 ? '' : 's'} · ${total.toFixed(1)} s`
                : 'Analyse to preview what will be cut.'}
          </span>
          <span className="flex gap-1.5">
            <Button disabled={busy} onClick={() => void analyze()}>
              {busy ? <Loader2 size={13} className="animate-spin" /> : <AudioLines size={13} />} Analyse
            </Button>
            <Button variant="primary" disabled={busy || found?.length === 0} onClick={() => void apply()}>
              Remove
            </Button>
          </span>
        </div>
      </div>
    </Modal>
  )
}
