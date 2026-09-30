import { contextBridge, ipcRenderer } from 'electron'
import {
  EXPORT_IPC,
  IPC,
  LIBRARY_IPC,
  PROJECT_IPC,
  SETTINGS_IPC,
  type EdionApi,
  type ExportJobState
} from '@shared/ipc'
import { mediaApi } from './media'

const api: EdionApi = {
  platform: process.platform,
  automated: Boolean(process.env['EDION_SCREENSHOT']),
  onCloseRequested: (cb) => {
    const listener = (): void => cb()
    ipcRenderer.on(IPC.closeRequested, listener)
    return () => ipcRenderer.removeListener(IPC.closeRequested, listener)
  },
  confirmClose: () => ipcRenderer.send(IPC.closeConfirmed),
  copyText: (text) => ipcRenderer.send(IPC.copyText, text),
  ffmpeg: {
    info: () => ipcRenderer.invoke(IPC.ffmpegInfo),
    probe: (path) => ipcRenderer.invoke(IPC.ffmpegProbe, path)
  },
  dialog: {
    openMedia: () => ipcRenderer.invoke(IPC.dialogOpenMedia),
    saveFile: (defaultName, extensions) => ipcRenderer.invoke(IPC.dialogSaveFile, defaultName, extensions),
    chooseFolder: () => ipcRenderer.invoke(IPC.dialogChooseFolder),
    openText: (extensions) => ipcRenderer.invoke(IPC.dialogOpenText, extensions),
    saveText: (defaultName, extensions, content) =>
      ipcRenderer.invoke(IPC.dialogSaveText, defaultName, extensions, content)
  },
  media: mediaApi,
  export: {
    start: (request) => ipcRenderer.invoke(EXPORT_IPC.start, request),
    cancel: (jobId) => ipcRenderer.invoke(EXPORT_IPC.cancel, jobId),
    list: () => ipcRenderer.invoke(EXPORT_IPC.list),
    clearFinished: () => ipcRenderer.invoke(EXPORT_IPC.clear),
    reveal: (path) => ipcRenderer.invoke(EXPORT_IPC.reveal, path),
    encoders: (codec) => ipcRenderer.invoke(EXPORT_IPC.encoders, codec),
    onUpdate: (cb) => {
      const listener = (_e: unknown, jobs: ExportJobState[]): void => cb(jobs)
      ipcRenderer.on(EXPORT_IPC.update, listener)
      return () => ipcRenderer.removeListener(EXPORT_IPC.update, listener)
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
    setTitle: (title, dirty) => ipcRenderer.send(PROJECT_IPC.setTitle, title, dirty),
    initialPath: () => ipcRenderer.invoke(PROJECT_IPC.initialPath)
  },
  library: {
    import: (paths) => ipcRenderer.invoke(LIBRARY_IPC.import, paths),
    exists: (paths) => ipcRenderer.invoke(LIBRARY_IPC.exists, paths),
    relink: (name) => ipcRenderer.invoke(LIBRARY_IPC.relink, name),
    fileUrl: (path) => ipcRenderer.invoke(LIBRARY_IPC.fileUrl, path),
    filmstrip: (path) => ipcRenderer.invoke(LIBRARY_IPC.filmstrip, path),
    peaks: (path) => ipcRenderer.invoke(LIBRARY_IPC.peaks, path),
    proxy: (path, mode) => ipcRenderer.invoke(LIBRARY_IPC.proxy, path, mode),
    saveRecording: (data, projectPath) => ipcRenderer.invoke(LIBRARY_IPC.saveRecording, data, projectPath),
    cacheSize: () => ipcRenderer.invoke(LIBRARY_IPC.cacheSize),
    clearCache: () => ipcRenderer.invoke(LIBRARY_IPC.clearCache),
    loudness: (path, start, duration) => ipcRenderer.invoke(LIBRARY_IPC.loudness, path, start, duration),
    collect: (paths, folder) => ipcRenderer.invoke(LIBRARY_IPC.collect, paths, folder),
    silences: (path, start, duration, thresholdDb, minSeconds) =>
      ipcRenderer.invoke(LIBRARY_IPC.silences, path, start, duration, thresholdDb, minSeconds)
  },
  settings: {
    get: () => ipcRenderer.invoke(SETTINGS_IPC.get),
    update: (patch) => ipcRenderer.invoke(SETTINGS_IPC.update, patch)
  }
}

contextBridge.exposeInMainWorld('edion', api)
