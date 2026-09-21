import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { IPC, SETTINGS_IPC, type AppSettings } from '@shared/ipc'
import { resolveFfmpeg } from './ffmpeg/paths'
import { probe } from './ffmpeg/probe'
import { readFileSync } from 'node:fs'
import { onExportUpdate, registerExportIpc, startExport } from './export'
import { allowFile, registerFileProtocolScheme, registerLibraryIpc } from './library'
import { registerProjectIpc } from './project'
import { getSettings, updateSettings } from './settings'
import { loadRendererPage } from './windows'

const MEDIA_EXTENSIONS = [
  'mp4',
  'mov',
  'mkv',
  'webm',
  'avi',
  'm4v',
  'mts',
  'ts',
  'mp3',
  'wav',
  'aac',
  'm4a',
  'flac',
  'ogg',
  'opus',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'bmp',
  'svg'
]

/** `EDION_SCREENSHOT=<png path>` saves a screenshot shortly after load and quits; used for visual checks. */
function captureForDebug(win: BrowserWindow): void {
  const target = process.env['EDION_SCREENSHOT']
  if (!target) return
  win.webContents.on('console-message', (e) => console.log('[renderer]', e.message))
  win.webContents.once('did-finish-load', () => {
    setTimeout(
      async () => {
        // Optional driver script: lets tests click around or inspect state before the capture.
        const script = process.env['EDION_DEBUG_SCRIPT']
        if (script) {
          await win.webContents.executeJavaScript(readFileSync(script, 'utf8')).then(
            (result) => console.log('[script]', result),
            (error) => console.log('[script error]', error)
          )
        }
        await win.webContents
          .capturePage()
          .then((image) => writeFile(target, image.toPNG()))
          .finally(() => app.exit(0))
      },
      Number(process.env['EDION_SCREENSHOT_DELAY'] ?? 2500)
    )
  })
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: '#0e0f11',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false,
      // A hidden test window would otherwise have its animation frames paused.
      backgroundThrottling: !process.env['EDION_SCREENSHOT']
    }
  })
  // Test runs (screenshots) must never put a window on the user's screen.
  if (!process.env['EDION_SCREENSHOT']) win.once('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  loadRendererPage(win, 'index')
  captureForDebug(win)
  return win
}

function registerIpc(): void {
  ipcMain.handle(IPC.ffmpegInfo, () => resolveFfmpeg())
  ipcMain.handle(IPC.ffmpegProbe, (_e, path: string) => probe(path))
  ipcMain.handle(IPC.dialogOpenMedia, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const options: Electron.OpenDialogOptions = {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Media', extensions: MEDIA_EXTENSIONS },
        { name: 'All files', extensions: ['*'] }
      ]
    }
    const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return res.canceled ? [] : res.filePaths
  })
  ipcMain.handle(IPC.dialogSaveFile, async (e, defaultName: string, extensions: string[]) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const options: Electron.SaveDialogOptions = {
      defaultPath: defaultName,
      filters: [{ name: 'Output', extensions }]
    }
    const res = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    return res.canceled ? null : (res.filePath ?? null)
  })
  ipcMain.handle(SETTINGS_IPC.get, () => getSettings())
  ipcMain.handle(SETTINGS_IPC.update, (_e, patch: Partial<AppSettings>) => updateSettings(patch))
  registerExportIpc()
  registerProjectIpc()
  registerLibraryIpc()
}

registerFileProtocolScheme()

/**
 * `EDION_HEADLESS_EXPORT=<project.edion>::<output>[::<encoder>]` exports a project without UI and exits.
 * Used by the end-to-end export tests.
 */
function runHeadlessExport(): boolean {
  const spec = process.env['EDION_HEADLESS_EXPORT']
  if (!spec) return false
  const [projectPath, outputPath, encoder = 'software'] = spec.split('::')
  if (!projectPath || !outputPath) throw new Error('EDION_HEADLESS_EXPORT must be <project>::<output>')
  const projectJson = readFileSync(projectPath, 'utf8')
  const { settings, media } = JSON.parse(projectJson) as {
    settings: { width: number; height: number }
    media: Array<{ path: string }>
  }
  for (const { path } of media) allowFile(path)
  onExportUpdate(([job]) => {
    if (!job || job.state === 'running' || job.state === 'queued') return
    if (job.state !== 'done') console.error(`export ${job.state}: ${job.message ?? ''}`)
    else console.log(`export done with ${job.encoder}`)
    app.exit(job.state === 'done' ? 0 : 1)
  })
  startExport({
    projectJson,
    name: 'headless',
    outputPath,
    settings: {
      width: settings.width,
      height: settings.height,
      range: null,
      encoder,
      quality: 'high',
      audioBitrateKbps: 192
    }
  })
  return true
}

const isTestRun = Boolean(process.env['EDION_HEADLESS_EXPORT'] ?? process.env['EDION_SCREENSHOT'])

if (!isTestRun && !app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows().filter((w) => w.isVisible())
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
  void app.whenReady().then(async () => {
    await getSettings()
    registerIpc()
    if (runHeadlessExport()) return
    createMainWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
