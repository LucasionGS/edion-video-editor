import { contextBridge, ipcRenderer } from 'electron'
import { EXPORT_IPC, IPC, type EdionApi, type ExportProgress } from '@shared/ipc'
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
  }
}

contextBridge.exposeInMainWorld('edion', api)
