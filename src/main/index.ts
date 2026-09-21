import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, clipboard, dialog, ipcMain, session, shell } from 'electron'
import { IPC, SETTINGS_IPC, type AppSettings } from '@shared/ipc'
import { resolveFfmpeg } from './ffmpeg/paths'
import { probe } from './ffmpeg/probe'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { cancelAllExports, onExportUpdate, registerExportIpc, startExport } from './export'
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

/** Installed fonts for the text tools, and the microphone for voiceovers. Everything else is denied. */
const ALLOWED_PERMISSIONS = new Set<string>(['local-fonts', 'media'])

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
      backgroundThrottling: !process.env['EDION_SCREENSHOT'],
      // Offscreen rendering keeps painting without ever showing a window.
      offscreen: Boolean(process.env['EDION_SCREENSHOT'])
    }
  })
  // Test runs (screenshots) must never put a window on the user's screen.
  if (!process.env['EDION_SCREENSHOT']) win.once('ready-to-show', () => win.show())
  // Closing goes through the renderer so unsaved work can be saved or knowingly discarded.
  let closeConfirmed = false
  win.on('close', (event) => {
    if (closeConfirmed || process.env['EDION_SCREENSHOT']) return
    event.preventDefault()
    win.webContents.send(IPC.closeRequested)
  })
  ipcMain.on(IPC.closeConfirmed, (event) => {
    if (event.sender !== win.webContents) return
    closeConfirmed = true
    win.close()
  })
  win.on('closed', () => {
    if (BrowserWindow.getAllWindows().every((w) => !w.isVisible())) cancelAllExports()
  })
  // If the page is broken it can never confirm; never trap the user in the window.
  win.webContents.on('render-process-gone', () => (closeConfirmed = true))
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
  ipcMain.handle(IPC.dialogChooseFolder, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const res = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
    return res.canceled ? null : (res.filePaths[0] ?? null)
  })
  ipcMain.handle(IPC.dialogOpenText, async (e, extensions: string[]) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const res = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'Text', extensions }]
    })
    const path = res.filePaths[0]
    return res.canceled || !path ? null : { path, content: await readFile(path, 'utf8') }
  })
  ipcMain.handle(
    IPC.dialogSaveText,
    async (e, defaultName: string, extensions: string[], content: string) => {
      const win = BrowserWindow.fromWebContents(e.sender)!
      const res = await dialog.showSaveDialog(win, {
        defaultPath: defaultName,
        filters: [{ name: 'Text', extensions }]
      })
      if (res.canceled || !res.filePath) return null
      await writeFile(res.filePath, content, 'utf8')
      return res.filePath
    }
  )
  ipcMain.on(IPC.copyText, (_e, text: string) => {
    // Automated runs must not overwrite whatever the user has on their clipboard.
    if (isAutomatedRun) console.log('[clipboard]', text)
    else clipboard.writeText(text)
  })
  ipcMain.handle(SETTINGS_IPC.get, () => getSettings())
  ipcMain.handle(SETTINGS_IPC.update, (_e, patch: Partial<AppSettings>) => updateSettings(patch))
  registerExportIpc()
  registerProjectIpc()
  registerLibraryIpc()
}

// Automated runs get a throwaway profile, so they can never touch the user's settings, recents, autosaves or cache.
const isAutomatedRun = Boolean(process.env['EDION_SCREENSHOT'] || process.env['EDION_HEADLESS_EXPORT'])
if (isAutomatedRun) {
  // Chromium's helper processes can outlive us and re-create files, so exit-time cleanup is best effort;
  // sweep profiles left behind by earlier runs (old enough not to belong to a run in progress).
  for (const name of readdirSync(tmpdir())) {
    if (!name.startsWith('edion-test-profile-')) continue
    const stale = join(tmpdir(), name)
    if (Date.now() - statSync(stale).mtimeMs > 10 * 60_000) rmSync(stale, { recursive: true, force: true })
  }
  const profile = mkdtempSync(join(tmpdir(), 'edion-test-profile-'))
  app.setPath('userData', profile)
  // `app.exit()` skips Electron's quit events, so clean up on the process itself.
  process.on('exit', () => rmSync(profile, { recursive: true, force: true }))
}

// Automated runs must stay silent as well as invisible.
if (process.env['EDION_SCREENSHOT'] || process.env['EDION_HEADLESS_EXPORT'])
  app.commandLine.appendSwitch('mute-audio')

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
    // Lets the text tools list installed fonts (Local Font Access API).
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) =>
      callback(ALLOWED_PERMISSIONS.has(permission))
    )
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission))
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
