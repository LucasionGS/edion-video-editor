import { useEffect, useState } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { Film, Layers, SlidersHorizontal } from 'lucide-react'
import type { FfmpegInfo } from '@shared/ipc'
import { EmptyState, PanelFrame } from '@/ui/Panel'
import { SpikePanel } from '@/features/export/SpikePanel'

export function App() {
  const [ffmpeg, setFfmpeg] = useState<FfmpegInfo | null>(null)
  const [ffmpegError, setFfmpegError] = useState<string | null>(null)

  useEffect(() => {
    window.edion.ffmpeg.info().then(setFfmpeg, (e: Error) => setFfmpegError(e.message))
  }, [])

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-10 shrink-0 items-center justify-between border-b border-line bg-surface px-3">
        <div className="flex items-center gap-2">
          <Film size={16} className="text-accent" />
          <span className="text-sm font-semibold">Edion</span>
          <span className="text-xs text-faint">Untitled project</span>
        </div>
        <span className={`text-2xs ${ffmpegError ? 'text-danger' : 'text-faint'}`}>
          {ffmpegError ?? (ffmpeg ? `FFmpeg ${ffmpeg.version} · ${ffmpeg.source}` : 'Locating FFmpeg…')}
        </span>
      </header>

      <Group orientation="vertical" className="min-h-0 flex-1">
        <Panel defaultSize="62" minSize="30">
          <Group orientation="horizontal">
            <Panel defaultSize="22" minSize={200} collapsible>
              <PanelFrame title="Library">
                <EmptyState
                  icon={<Layers size={22} />}
                  title="No media yet"
                  hint="Media, text, transitions and effects will live here."
                />
              </PanelFrame>
            </Panel>
            <Separator className="w-px bg-line" />
            <Panel minSize="30">
              <SpikePanel />
            </Panel>
            <Separator className="w-px bg-line" />
            <Panel defaultSize="22" minSize={220} collapsible>
              <PanelFrame title="Inspector">
                <EmptyState
                  icon={<SlidersHorizontal size={22} />}
                  title="Nothing selected"
                  hint="Select a clip to edit its properties."
                />
              </PanelFrame>
            </Panel>
          </Group>
        </Panel>
        <Separator className="h-px bg-line" />
        <Panel minSize="20">
          <PanelFrame title="Timeline">
            <EmptyState icon={<Film size={22} />} title="Timeline" hint="Arrives in milestone 3." />
          </PanelFrame>
        </Panel>
      </Group>
    </div>
  )
}
