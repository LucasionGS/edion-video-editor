import { copyFile, mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { PROJECT_EXTENSION, PROJECT_IPC, type AutosaveInfo, type ProjectFile } from '@shared/ipc'
import { addRecent, writeFileAtomic } from './settings'

const FILTERS = [{ name: 'Edion project', extensions: [PROJECT_EXTENSION] }]
const autosaveDir = (): string => join(app.getPath('userData'), 'autosave')
const autosaveFile = (id: string): string => join(autosaveDir(), `${id.replace(/[^\w-]/g, '')}.json`)

interface AutosaveEnvelope extends AutosaveInfo {
  json: string
}

async function readProject(path: string): Promise<ProjectFile> {
  return { path, json: await readFile(path, 'utf8') }
}

async function save(path: string, json: string, name: string): Promise<string> {
  // Keep the previous version around: cheap insurance against a bad save.
  await copyFile(path, `${path}.bak`).catch(() => {})
  await writeFileAtomic(path, json)
  await addRecent({ path, name })
  return path
}

export function registerProjectIpc(): void {
  ipcMain.handle(PROJECT_IPC.open, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const res = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: FILTERS })
    const path = res.filePaths[0]
    return res.canceled || !path ? null : readProject(path)
  })
  ipcMain.handle(PROJECT_IPC.read, (_e, path: string) => readProject(path))
  ipcMain.handle(PROJECT_IPC.save, (_e, path: string, json: string, name: string) => save(path, json, name))
  ipcMain.handle(PROJECT_IPC.saveAs, async (e, defaultName: string, json: string, name: string) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const res = await dialog.showSaveDialog(win, {
      defaultPath: `${defaultName}.${PROJECT_EXTENSION}`,
      filters: FILTERS
    })
    if (res.canceled || !res.filePath) return null
    const path = res.filePath.endsWith(`.${PROJECT_EXTENSION}`)
      ? res.filePath
      : `${res.filePath}.${PROJECT_EXTENSION}`
    return save(path, json, name === 'Untitled project' ? basename(path, `.${PROJECT_EXTENSION}`) : name)
  })

  ipcMain.handle(PROJECT_IPC.autosave, async (_e, info: Omit<AutosaveInfo, 'savedAt'>, json: string) => {
    const envelope: AutosaveEnvelope = { ...info, savedAt: Date.now(), json }
    await writeFileAtomic(autosaveFile(info.projectId), JSON.stringify(envelope))
  })
  ipcMain.handle(PROJECT_IPC.listAutosaves, async (): Promise<AutosaveInfo[]> => {
    await mkdir(autosaveDir(), { recursive: true })
    const infos: AutosaveInfo[] = []
    for (const name of await readdir(autosaveDir())) {
      if (!name.endsWith('.json')) continue
      try {
        const { json: _json, ...info } = JSON.parse(
          await readFile(join(autosaveDir(), name), 'utf8')
        ) as AutosaveEnvelope
        infos.push(info)
      } catch {
        // A damaged autosave is useless; ignore it.
      }
    }
    return infos.sort((a, b) => b.savedAt - a.savedAt)
  })
  ipcMain.handle(PROJECT_IPC.readAutosave, async (_e, id: string) => {
    return (JSON.parse(await readFile(autosaveFile(id), 'utf8')) as AutosaveEnvelope).json
  })
  ipcMain.handle(PROJECT_IPC.clearAutosave, (_e, id: string) => rm(autosaveFile(id), { force: true }))

  ipcMain.on(PROJECT_IPC.setTitle, (e, title: string, dirty: boolean) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return
    win.setTitle(`${dirty ? '● ' : ''}${title} — Edion`)
    win.setDocumentEdited(dirty)
  })
}
