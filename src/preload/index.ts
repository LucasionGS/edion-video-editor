import { contextBridge, ipcRenderer } from 'electron'
import {
  EXPORT_IPC,
  IPC,
  LIBRARY_IPC,
  PROJECT_IPC,
  SETTINGS_IPC,
  type EdionApi,
  type ExportProgress
} from '@shared/ipc'
import { mediaApi } from './media'

const api: EdionApi = {
  platform: process.platform,
  ffmpeg: {
    info: () => ipcRenderer.invoke(IPC.ffmpegInfo),
    probe: (path) => ipcRenderer.invoke(IPC.ffmpegProbe, path)
  },
  dialog: {
    openMedia: () => ipcRenderer.invoke(IPC.dialogOpenMedia),
    saveFile: (defaultName, extensions) => ipcRenderer.invoke(IPC.dialogSaveFile, defaultName, extensions)
  },
  media: mediaApi,
  export: {
    start: (job) => ipcRenderer.invoke(EXPORT_IPC.start, job),
    cancel: (jobId) => ipcRenderer.invoke(EXPORT_IPC.cancel, jobId),
    onProgress: (cb) => {
      const listener = (_e: unknown, p: ExportProgress): void => cb(p)
      ipcRenderer.on(EXPORT_IPC.progress, listener)
      return () => ipcRenderer.removeListener(EXPORT_IPC.progress, listener)
    }
  },
  project: {
    open: () => ipcRenderer.invoke(PROJECT_IPC.open),
    read: (path) => ipcRenderer.invoke(PROJECT_IPC.read, path),
    save: (path, json, name) => ipcRenderer.invoke(PROJECT_IPC.save, path, json, name),
    saveAs: (defaultName, json, name) => ipcRenderer.invoke(PROJECT_IPC.saveAs, defaultName, json, name),
    autosave: (info, json) => ipcRenderer.invoke(PROJECT_IPC.autosave, info, json),
    listAutosaves: () => ipcRenderer.invoke(PROJECT_IPC.listAutosaves),
    readAutosave: (id) => ipcRenderer.invoke(PROJECT_IPC.readAutosave, id),
    clearAutosave: (id) => ipcRenderer.invoke(PROJECT_IPC.clearAutosave, id),
    setTitle: (title, dirty) => ipcRenderer.send(PROJECT_IPC.setTitle, title, dirty)
  },
  library: {
    import: (paths) => ipcRenderer.invoke(LIBRARY_IPC.import, paths),
    exists: (paths) => ipcRenderer.invoke(LIBRARY_IPC.exists, paths),
    relink: (name) => ipcRenderer.invoke(LIBRARY_IPC.relink, name),
    fileUrl: (path) => ipcRenderer.invoke(LIBRARY_IPC.fileUrl, path),
    filmstrip: (path) => ipcRenderer.invoke(LIBRARY_IPC.filmstrip, path),
    peaks: (path) => ipcRenderer.invoke(LIBRARY_IPC.peaks, path)
  },
  settings: {
    get: () => ipcRenderer.invoke(SETTINGS_IPC.get),
    update: (patch) => ipcRenderer.invoke(SETTINGS_IPC.update, patch)
  }
}

contextBridge.exposeInMainWorld('edion', api)
