import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { IPC, SETTINGS_IPC, type AppSettings } from '@shared/ipc'
import { resolveFfmpeg } from './ffmpeg/paths'
import { probe } from './ffmpeg/probe'
import { onExportProgress, registerExportIpc, startExport } from './export'
import { registerFileProtocolScheme, registerLibraryIpc } from './library'
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
  win.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      void win.webContents
        .capturePage()
        .then((image) => writeFile(target, image.toPNG()))
        .finally(() => app.exit(0))
    }, 1500)
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
      sandbox: false
    }
  })
  win.once('ready-to-show', () => win.show())
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

/** `EDION_HEADLESS_EXPORT=<input>::<output>` runs one export without UI and exits; used by the golden export test. */
function runHeadlessExport(): boolean {
  const spec = process.env['EDION_HEADLESS_EXPORT']
  if (!spec) return false
  const [inputPath, outputPath] = spec.split('::')
  if (!inputPath || !outputPath) throw new Error('EDION_HEADLESS_EXPORT must be <input>::<output>')
  onExportProgress((p) => {
    if (p.state === 'running') return
    if (p.state !== 'done') console.error(`export ${p.state}: ${p.message ?? ''}`)
    app.exit(p.state === 'done' ? 0 : 1)
  })
  startExport({ inputPath, outputPath })
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
