import { useEffect, useState } from 'react'
import type { AppSettings, FfmpegInfo } from '@shared/ipc'
import { toast } from '@/store/feedback'
import { Button } from '@/ui/Button'
import { Field } from '@/ui/Field'
import { Modal } from '@/ui/Modal'
import { NumberInput } from '@/ui/NumberInput'
import { ShortcutsEditor } from './ShortcutsEditor'

const formatBytes = (bytes: number): string =>
  bytes > 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [ffmpeg, setFfmpeg] = useState<FfmpegInfo | null>(null)
  const [cacheBytes, setCacheBytes] = useState<number | null>(null)
  const [tab, setTab] = useState<'general' | 'shortcuts'>('general')

  const refresh = (): void => {
    void window.edion.ffmpeg.info().then(setFfmpeg, () => setFfmpeg(null))
    void window.edion.library.cacheSize().then(setCacheBytes)
  }
  useEffect(() => {
    void window.edion.settings.get().then(setSettings)
    refresh()
  }, [])

  const update = async (patch: Partial<Omit<AppSettings, 'recents'>>): Promise<void> => {
    setSettings(await window.edion.settings.update(patch))
    refresh()
  }
  if (!settings) return null

  return (
    <Modal title="Settings" onClose={onClose}>
      <nav className="flex gap-1 border-b border-line px-4 pt-2">
        {(['general', 'shortcuts'] as const).map((id) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`border-b-2 px-2 pb-1.5 text-xs capitalize ${tab === id ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg'}`}
          >
            {id}
          </button>
        ))}
      </nav>
      {tab === 'shortcuts' ? <ShortcutsEditor /> : null}
      <div className={tab === 'general' ? '' : 'hidden'}>
        <div className="flex flex-col gap-3 p-4">
          <Field label="Autosave" hint="seconds">
            <NumberInput
              label="Autosave interval"
              value={settings.autosaveSeconds}
              min={5}
              max={600}
              step={5}
              precision={0}
              onChange={(v) => void update({ autosaveSeconds: v })}
            />
          </Field>
          <Field label="Proxies">
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                className="accent-(--color-accent)"
                checked={settings.proxiesEnabled}
                onChange={(e) => void update({ proxiesEnabled: e.target.checked })}
              />
              Create lightweight preview copies of 4K and HEVC/AV1/ProRes footage
            </label>
          </Field>
          <Field label="Cache">
            <span className="flex-1 text-xs text-muted">
              {cacheBytes === null ? '…' : formatBytes(cacheBytes)} of thumbnails, waveforms and proxies
            </span>
            <Button
              onClick={async () => {
                await window.edion.library.clearCache()
                refresh()
                toast('Cache cleared', 'success')
              }}
            >
              Clear
            </Button>
          </Field>
          <Field label="FFmpeg">
            <span
              className="min-w-0 flex-1 truncate text-xs text-muted select-text"
              title={ffmpeg?.ffmpegPath}
            >
              {ffmpeg ? `${ffmpeg.version} · ${ffmpeg.source}` : 'Not found'}
              {settings.ffmpegDir ? ` · ${settings.ffmpegDir}` : ''}
            </span>
            <Button
              onClick={async () => {
                const dir = await window.edion.dialog.chooseFolder()
                if (dir) await update({ ffmpegDir: dir })
              }}
            >
              Choose folder…
            </Button>
            {settings.ffmpegDir && (
              <Button onClick={() => void update({ ffmpegDir: null })}>Use bundled</Button>
            )}
          </Field>
          <p className="text-2xs leading-relaxed text-faint">
            Edion ships with its own FFmpeg. Point it at a folder containing <code>ffmpeg</code> and{' '}
            <code>ffprobe</code> to use a different build, for example one with GPU encoders. Hardware
            encoders from an FFmpeg installed on your system are picked up automatically.
          </p>
        </div>
      </div>
    </Modal>
  )
}
