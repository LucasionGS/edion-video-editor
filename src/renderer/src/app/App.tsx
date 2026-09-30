import { useCallback, useEffect, useState } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { ExportDialog } from '@/features/export/ExportDialog'
import { Inspector } from '@/features/inspector/Inspector'
import { SettingsDialog } from '@/features/settings/SettingsDialog'
import { Welcome } from '@/features/welcome/Welcome'
import { RemoveSilenceDialog } from '@/features/tools/RemoveSilenceDialog'
import { useDialogs } from '@/store/dialogs'
import { loadPresets } from '@/store/presets'
import { PromptDialog } from '@/ui/PromptDialog'
import { Library } from '@/features/library/Library'
import { Timeline } from '@/features/timeline/Timeline'
import { Viewer } from '@/features/viewer/Viewer'
import { isDirty, loadSnapSettings, useEditor } from '@/store/editor'
import { wireExports } from '@/store/exports'
import { autosave, confirmDiscard, openProject } from '@/store/projectActions'
import { activeJob, useExports } from '@/store/exports'
import { confirm } from '@/store/feedback'
import { ContextMenuHost } from '@/ui/ContextMenu'
import { ConfirmDialog, Toasts } from '@/ui/Feedback'
import { PanelFrame } from '@/ui/Panel'
import { useShortcuts } from './shortcuts'
import { TopBar } from './TopBar'

export function App() {
  const [exportOpen, setExportOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  useCloseGuard()
  useShortcuts(useCallback(() => setExportOpen(true), []))
  useWindowTitle()
  useAutosave()
  useEffect(wireExports, [])
  useEffect(() => void loadSnapSettings(), [])
  useEffect(() => void loadPresets(), [])
  useEffect(() => {
    void window.edion.project.initialPath().then((path) => {
      if (path) void openProject(path)
    })
  }, [])

  return (
    <div className="flex h-full flex-col">
      <TopBar onExport={() => setExportOpen(true)} onSettings={() => setSettingsOpen(true)} />
      <Group orientation="vertical" className="min-h-0 flex-1">
        <Panel defaultSize="58" minSize="25">
          <Group orientation="horizontal">
            <Panel defaultSize="24" minSize={200} collapsible>
              <Library />
            </Panel>
            <Separator className="w-px bg-line" />
            <Panel minSize="30">
              <Viewer />
            </Panel>
            <Separator className="w-px bg-line" />
            <Panel defaultSize="22" minSize={220} collapsible>
              <PanelFrame title="Inspector">
                <Inspector />
              </PanelFrame>
            </Panel>
          </Group>
        </Panel>
        <Separator className="h-px bg-line" />
        <Panel minSize="20">
          <Timeline />
        </Panel>
      </Group>
      {exportOpen && <ExportDialog onClose={() => setExportOpen(false)} />}
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      <DialogHost />
      <Welcome />
      <ContextMenuHost />
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

/** Closing the window first deals with unsaved changes and running exports. */
function useCloseGuard(): void {
  useEffect(
    () =>
      window.edion.onCloseRequested(async () => {
        if (activeJob(useExports.getState().jobs)) {
          const answer = await confirm({
            title: 'An export is still running',
            message: 'Closing Edion now cancels it.',
            confirmLabel: 'Close anyway',
            danger: true
          })
          if (answer !== 'confirm') return
        }
        if (await confirmDiscard()) window.edion.confirmClose()
      }),
    []
  )
}

function DialogHost() {
  const open = useDialogs((s) => s.open)
  if (open?.kind === 'removeSilence') return <RemoveSilenceDialog clipId={open.clipId} />
  if (open?.kind === 'prompt') return <PromptDialog key={open.title} {...open} />
  return null
}
