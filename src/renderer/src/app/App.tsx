import { useEffect, useState } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { SlidersHorizontal } from 'lucide-react'
import { MediaLibrary } from '@/features/library/MediaLibrary'
import { Timeline } from '@/features/timeline/Timeline'
import { Viewer } from '@/features/viewer/Viewer'
import { isDirty, useEditor } from '@/store/editor'
import { autosave, openProject } from '@/store/projectActions'
import { ConfirmDialog, Toasts } from '@/ui/Feedback'
import { EmptyState, PanelFrame } from '@/ui/Panel'
import { useShortcuts } from './shortcuts'
import { TopBar } from './TopBar'

export function App() {
  const [exportOpen, setExportOpen] = useState(false)
  useShortcuts()
  useWindowTitle()
  useAutosave()
  useEffect(() => {
    void window.edion.project.initialPath().then((path) => {
      if (path) void openProject(path)
    })
  }, [])

  return (
    <div className="flex h-full flex-col">
      <TopBar onExport={() => setExportOpen(true)} />
      <Group orientation="vertical" className="min-h-0 flex-1">
        <Panel defaultSize="58" minSize="25">
          <Group orientation="horizontal">
            <Panel defaultSize="24" minSize={200} collapsible>
              <PanelFrame title="Media">
                <MediaLibrary />
              </PanelFrame>
            </Panel>
            <Separator className="w-px bg-line" />
            <Panel minSize="30">
              <Viewer />
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
          <Timeline />
        </Panel>
      </Group>
      {exportOpen && null}
      <Toasts />
      <ConfirmDialog />
    </div>
  )
}

function useWindowTitle(): void {
  const name = useEditor((s) => s.project.name)
  const dirty = useEditor((s) => isDirty(s))
  useEffect(() => window.edion.project.setTitle(name, dirty), [name, dirty])
}

function useAutosave(): void {
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined
    void window.edion.settings.get().then((settings) => {
      timer = setInterval(() => void autosave(), Math.max(5, settings.autosaveSeconds) * 1000)
    })
    return () => clearInterval(timer)
  }, [])
}
