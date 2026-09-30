import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import type { AppSettings, RecentProject } from '@shared/ipc'
import { setCustomFfmpegDir } from './ffmpeg/paths'

const DEFAULTS: AppSettings = {
  ffmpegDir: null,
  autosaveSeconds: 30,
  proxiesEnabled: true,
  shortcuts: {},
  snapping: null,
  timeDisplay: 'time',
  effectPresets: [],
  textStyles: [],
  recents: []
}
const MAX_RECENTS = 12

let settings: AppSettings | null = null
const file = (): string => join(app.getPath('userData'), 'settings.json')

/** Write-then-rename so a crash mid-write can never leave a half-written file. */
export async function writeFileAtomic(path: string, data: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.${process.pid}.tmp`
  await writeFile(temp, data)
  await rename(temp, path)
}

export async function getSettings(): Promise<AppSettings> {
  if (settings) return settings
  try {
    settings = { ...DEFAULTS, ...(JSON.parse(await readFile(file(), 'utf8')) as Partial<AppSettings>) }
  } catch {
    settings = { ...DEFAULTS }
  }
  setCustomFfmpegDir(settings.ffmpegDir)
  return settings
}

export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  settings = { ...(await getSettings()), ...patch }
  setCustomFfmpegDir(settings.ffmpegDir)
  await writeFileAtomic(file(), JSON.stringify(settings, null, 2))
  return settings
}

export async function addRecent(recent: Omit<RecentProject, 'openedAt'>): Promise<void> {
  const current = await getSettings()
  const recents = [
    { ...recent, openedAt: Date.now() },
    ...current.recents.filter((r) => r.path !== recent.path)
  ].slice(0, MAX_RECENTS)
  await updateSettings({ recents })
  app.addRecentDocument(recent.path)
}
