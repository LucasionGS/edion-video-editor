import { useEffect } from 'react'
import { jumpSeconds, seek, seekToEnd, stepFrames, togglePlayback } from '@/engine/playback/session'
import {
  copySelection,
  cutSelection,
  deleteSelection,
  duplicateSelection,
  paste,
  selectAll,
  splitAtPlayhead
} from '@/store/commands'
import { redo, select, setZoom, undo, useEditor } from '@/store/editor'
import { newProject, openProject, saveProject } from '@/store/projectActions'

type Handler = (e: KeyboardEvent) => void

/** Keys are `[ctrl+][shift+][alt+]<key>` with the key lower-cased. */
const SHORTCUTS: Record<string, Handler> = {
  ' ': togglePlayback,
  k: () => useEditor.setState({ playing: false }),
  l: () => (useEditor.getState().playing ? jumpSeconds(1) : togglePlayback()),
  j: () => jumpSeconds(-1),
  arrowleft: () => stepFrames(-1),
  arrowright: () => stepFrames(1),
  'shift+arrowleft': () => stepFrames(-10),
  'shift+arrowright': () => stepFrames(10),
  home: () => seek(0),
  end: seekToEnd,
  s: splitAtPlayhead,
  'ctrl+b': splitAtPlayhead,
  delete: () => deleteSelection(),
  backspace: () => deleteSelection(),
  'shift+delete': () => deleteSelection(true),
  'ctrl+z': undo,
  'ctrl+shift+z': redo,
  'ctrl+y': redo,
  'ctrl+c': copySelection,
  'ctrl+x': cutSelection,
  'ctrl+v': paste,
  'ctrl+d': duplicateSelection,
  'ctrl+a': selectAll,
  escape: () => {
    select([])
    useEditor.setState({ tool: 'select' })
  },
  v: () => useEditor.setState({ tool: 'select' }),
  c: () => useEditor.setState({ tool: 'razor' }),
  n: () => useEditor.setState((s) => ({ snapping: !s.snapping })),
  '=': () => setZoom(useEditor.getState().zoom * 1.4),
  '+': () => setZoom(useEditor.getState().zoom * 1.4),
  '-': () => setZoom(useEditor.getState().zoom / 1.4),
  'ctrl+s': () => void saveProject(),
  'ctrl+shift+s': () => void saveProject(true),
  'ctrl+o': () => void openProject(),
  'ctrl+n': () => void newProject()
}

const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))

export function useShortcuts(extra: Record<string, Handler> = {}): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isTyping(e.target) && !(e.ctrlKey || e.metaKey)) return
      // Leave native clipboard/undo alone inside text fields.
      if (isTyping(e.target) && ['z', 'y', 'c', 'x', 'v', 'a'].includes(e.key.toLowerCase())) return
      const combo = `${e.ctrlKey || e.metaKey ? 'ctrl+' : ''}${e.shiftKey ? 'shift+' : ''}${e.altKey ? 'alt+' : ''}${e.key.toLowerCase()}`
      const handler = extra[combo] ?? SHORTCUTS[combo]
      if (!handler) return
      e.preventDefault()
      handler(e)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [extra])
}
