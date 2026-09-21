import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { BrowserWindow, ipcMain } from 'electron'
import { EXPORT_IPC, type ExportJob, type ExportProgress } from '@shared/ipc'
import { resolveFfmpeg } from './ffmpeg/paths'
import { loadRendererPage } from './windows'

interface RunningJob {
  job: ExportJob
  window: BrowserWindow
  finished: boolean
}

const jobs = new Map<string, RunningJob>()

function broadcast(progress: ExportProgress): void {
  for (const cb of listeners) cb(progress)
  for (const win of BrowserWindow.getAllWindows()) {
    const isExportWindow = [...jobs.values()].some((j) => j.window === win)
    if (!isExportWindow && !win.isDestroyed()) win.webContents.send(EXPORT_IPC.progress, progress)
  }
}

function endJob(id: string, progress?: ExportProgress): void {
  const running = jobs.get(id)
  if (!running || running.finished) return
  running.finished = true
  if (progress) broadcast(progress)
  jobs.delete(id)
  if (!running.window.isDestroyed()) running.window.destroy()
}

const listeners = new Set<(p: ExportProgress) => void>()

/** Observe export progress from the main process (used by the headless test harness). */
export function onExportProgress(cb: (p: ExportProgress) => void): void {
  listeners.add(cb)
}

export function startExport(request: Omit<ExportJob, 'id'>): string {
  const job: ExportJob = { ...request, id: randomUUID() }
  const window = new BrowserWindow({
    show: false,
    width: 640,
    height: 360,
    webPreferences: {
      preload: join(__dirname, '../preload/export.js'),
      contextIsolation: true,
      sandbox: false,
      backgroundThrottling: false
    }
  })
  jobs.set(job.id, { job, window, finished: false })
  window.webContents.on('render-process-gone', (_ev, details) => {
    endJob(job.id, {
      jobId: job.id,
      frame: 0,
      totalFrames: 0,
      state: 'error',
      message: `Export process crashed (${details.reason})`
    })
  })
  if (process.env['EDION_DEBUG_EXPORT']) {
    window.webContents.on('console-message', (ev) => console.log('[export]', ev.message))
  }
  loadRendererPage(window, 'export', job.id)
  return job.id
}

export function registerExportIpc(): void {
  ipcMain.handle(EXPORT_IPC.start, (_e, request: Omit<ExportJob, 'id'>) => startExport(request))

  ipcMain.handle(EXPORT_IPC.getJob, async (_e, id: string) => {
    const running = jobs.get(id)
    if (!running) throw new Error(`Unknown export job ${id}`)
    const { ffmpegPath } = await resolveFfmpeg()
    return { job: running.job, ffmpegPath }
  })

  ipcMain.on(EXPORT_IPC.progress, (_e, progress: ExportProgress) => {
    if (progress.state === 'running') broadcast(progress)
    else endJob(progress.jobId, progress)
  })

  ipcMain.handle(EXPORT_IPC.cancel, (_e, id: string) => {
    const running = jobs.get(id)
    if (!running) return
    running.window.webContents.send(EXPORT_IPC.abort)
    // The export window cleans up and reports 'cancelled'; force it if it is unresponsive.
    setTimeout(() => {
      endJob(id, { jobId: id, frame: 0, totalFrames: 0, state: 'cancelled' })
    }, 3000)
  })
}
