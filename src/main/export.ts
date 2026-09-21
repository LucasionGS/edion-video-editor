import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { BrowserWindow, ipcMain, shell } from 'electron'
import {
  EXPORT_IPC,
  type EncoderInfo,
  type ExportJobState,
  type ExportProgress,
  type ExportRequest,
  type ResolvedEncoder
} from '@shared/ipc'
import { detectEncoders } from './ffmpeg/hwdetect'
import { loadRendererPage } from './windows'

interface Job {
  state: ExportJobState
  request: ExportRequest
  window: BrowserWindow | null
}

/** Exports run one at a time, each in its own hidden window; the rest wait in line. */
const jobs: Job[] = []
const listeners = new Set<(jobs: ExportJobState[]) => void>()
const isFinished = (job: Job): boolean => ['done', 'error', 'cancelled'].includes(job.state.state)
const snapshot = (): ExportJobState[] => jobs.map((j) => ({ ...j.state }))

/** Observe the queue from the main process (used by the headless test harness). */
export const onExportUpdate = (cb: (jobs: ExportJobState[]) => void): void => void listeners.add(cb)

function broadcast(): void {
  const states = snapshot()
  for (const cb of listeners) cb(states)
  const exportWindows = new Set(jobs.map((j) => j.window))
  for (const win of BrowserWindow.getAllWindows()) {
    if (!exportWindows.has(win) && !win.isDestroyed()) win.webContents.send(EXPORT_IPC.update, states)
  }
}

function finish(job: Job, state: ExportJobState['state'], message?: string): void {
  if (isFinished(job)) return
  Object.assign(job.state, { state, message, finishedAt: Date.now() })
  const window = job.window
  job.window = null
  if (window && !window.isDestroyed()) window.destroy()
  broadcast()
  startNext()
}

function startNext(): void {
  if (jobs.some((j) => j.state.state === 'running')) return
  const job = jobs.find((j) => j.state.state === 'queued')
  if (!job) return
  Object.assign(job.state, { state: 'running', startedAt: Date.now() })
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
  job.window = window
  window.webContents.on('render-process-gone', (_e, details) =>
    finish(job, 'error', `The export process crashed (${details.reason}).`)
  )
  if (process.env['EDION_DEBUG_EXPORT']) {
    window.webContents.on('console-message', (e) => console.log('[export]', e.message))
  }
  loadRendererPage(window, 'export', job.state.id)
  broadcast()
}

export function startExport(request: ExportRequest): string {
  const id = randomUUID()
  jobs.push({
    request,
    window: null,
    state: {
      id,
      name: request.name,
      outputPath: request.outputPath,
      state: 'queued',
      phase: 'audio',
      frame: 0,
      totalFrames: 0,
      startedAt: null,
      finishedAt: null,
      encoder: null
    }
  })
  broadcast()
  startNext()
  return id
}

function encodersFor(choice: string, all: ResolvedEncoder[]): ResolvedEncoder[] {
  const software = all[all.length - 1]!
  if (choice === 'software') return [software]
  const preferred = choice === 'auto' ? all[0]! : (all.find((e) => e.name === choice) ?? all[0]!)
  return preferred === software ? [software] : [preferred, software]
}

export function registerExportIpc(): void {
  ipcMain.handle(EXPORT_IPC.start, (_e, request: ExportRequest) => startExport(request))
  ipcMain.handle(EXPORT_IPC.list, () => snapshot())
  ipcMain.handle(EXPORT_IPC.encoders, async (): Promise<EncoderInfo[]> =>
    (await detectEncoders()).map(({ name, label, hardware }) => ({ name, label, hardware }))
  )
  ipcMain.handle(EXPORT_IPC.reveal, (_e, path: string) => shell.showItemInFolder(path))
  ipcMain.handle(EXPORT_IPC.clear, () => {
    for (let i = jobs.length - 1; i >= 0; i--) if (isFinished(jobs[i]!)) jobs.splice(i, 1)
    broadcast()
  })

  ipcMain.handle(EXPORT_IPC.getJob, async (_e, id: string) => {
    const job = jobs.find((j) => j.state.id === id)
    if (!job) throw new Error(`Unknown export job ${id}`)
    return {
      request: job.request,
      encoders: encodersFor(job.request.settings.encoder, await detectEncoders())
    }
  })

  ipcMain.on(EXPORT_IPC.progress, (_e, id: string, progress: ExportProgress) => {
    const job = jobs.find((j) => j.state.id === id)
    if (!job || isFinished(job)) return
    const { state, message, ...rest } = progress
    Object.assign(job.state, rest)
    if (state === 'running') broadcast()
    else finish(job, state, message)
  })

  ipcMain.handle(EXPORT_IPC.cancel, (_e, id: string) => {
    const job = jobs.find((j) => j.state.id === id)
    if (!job || isFinished(job)) return
    if (job.state.state === 'queued' || !job.window) return finish(job, 'cancelled')
    job.window.webContents.send(EXPORT_IPC.abort)
    // The export window cleans up and reports back; force it if it is unresponsive.
    setTimeout(() => finish(job, 'cancelled'), 4000)
  })
}

/** True while something is rendering, so quitting can warn first. */
export const hasActiveExports = (): boolean => jobs.some((j) => !isFinished(j))
