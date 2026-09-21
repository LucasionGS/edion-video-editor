import { createHash } from 'node:crypto'
import { access, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain, net, protocol } from 'electron'
import {
  FILE_PROTOCOL,
  LIBRARY_IPC,
  type Filmstrip,
  type ImportedMedia,
  type MediaProbe,
  type Peaks,
  type ProxyMode
} from '@shared/ipc'
import { backgroundJobs, runFfmpeg } from './ffmpeg/jobs'
import { probe } from './ffmpeg/probe'
import { writeFileAtomic } from './settings'

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.svg', '.avif'])
const TILE_HEIGHT = 72
const MAX_TILES = 120
const PEAKS_PER_SECOND = 100
const PEAK_SAMPLE_RATE = 8000

/** Files the renderer may load through `edion-file://`: everything imported this session plus our cache. */
const allowedFiles = new Set<string>()
const cacheRoot = (): string => join(app.getPath('userData'), 'cache')

export const allowFile = (path: string): void => void allowedFiles.add(resolve(path))

export const fileUrl = (path: string): string => `${FILE_PROTOCOL}://local/${encodeURIComponent(path)}`

export function registerFileProtocolScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: FILE_PROTOCOL,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
    }
  ])
}

function registerFileProtocol(): void {
  protocol.handle(FILE_PROTOCOL, (request) => {
    const path = resolve(decodeURIComponent(new URL(request.url).pathname.slice(1)))
    if (!allowedFiles.has(path) && !path.startsWith(cacheRoot() + sep)) {
      return new Response('Forbidden', { status: 403 })
    }
    return net.fetch(pathToFileURL(path).toString())
  })
}

/** Cache entries are keyed by path + size + mtime, so edited files are regenerated automatically. */
async function cacheDirFor(path: string): Promise<string> {
  const info = await stat(path)
  const key = createHash('sha1').update(`${path}:${info.size}:${info.mtimeMs}`).digest('hex').slice(0, 20)
  const dir = join(cacheRoot(), key)
  await mkdir(dir, { recursive: true })
  return dir
}

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false
  )

function classify(info: MediaProbe): ImportedMedia['kind'] | null {
  const video = info.streams.find((s) => s.kind === 'video')
  const audio = info.streams.find((s) => s.kind === 'audio')
  const looksLikeImage =
    IMAGE_EXTENSIONS.has(extname(info.path).toLowerCase()) || /image2|_pipe/.test(info.format)
  if (video && looksLikeImage) return 'image'
  if (video) return 'video'
  if (audio) return 'audio'
  return null
}

async function importOne(path: string): Promise<ImportedMedia | { error: string; path: string }> {
  try {
    const info = await probe(path)
    const kind = classify(info)
    if (!kind) return { path, error: 'No video, audio or image data found' }
    allowedFiles.add(resolve(path))
    return { kind, probe: info }
  } catch (error) {
    return { path, error: error instanceof Error ? error.message.split('\n')[0]! : String(error) }
  }
}

const filmstripJobs = new Map<string, Promise<Filmstrip | null>>()

async function buildFilmstrip(path: string): Promise<Filmstrip | null> {
  const info = await probe(path)
  const video = info.streams.find((s) => s.kind === 'video')
  if (!video?.width || !video.height || info.duration <= 0) return null
  const dir = await cacheDirFor(path)
  const sprite = join(dir, 'filmstrip.jpg')
  const meta = join(dir, 'filmstrip.json')
  if ((await exists(sprite)) && (await exists(meta))) {
    return { ...(JSON.parse(await readFile(meta, 'utf8')) as Omit<Filmstrip, 'url'>), url: fileUrl(sprite) }
  }
  const rotated = Math.abs(video.rotation ?? 0) % 180 === 90
  const aspect = rotated ? video.height / video.width : video.width / video.height
  const tileWidth = Math.max(2, Math.round((TILE_HEIGHT * aspect) / 2) * 2)
  const interval = Math.max(1, info.duration / MAX_TILES)
  const count = Math.max(1, Math.min(MAX_TILES, Math.ceil(info.duration / interval)))
  const render = (keyframesOnly: boolean): Promise<void> =>
    runFfmpeg({
      args: [
        '-y',
        ...(keyframesOnly ? ['-skip_frame', 'nokey'] : []),
        '-i',
        path,
        '-an',
        '-sn',
        '-vf',
        `fps=1/${interval},scale=${tileWidth}:${TILE_HEIGHT},tile=${count}x1`,
        '-frames:v',
        '1',
        '-q:v',
        '5',
        sprite
      ]
    })
  await backgroundJobs.run(async () => {
    // Decoding only keyframes is far faster on long files, but short clips may have too few of them to fill the strip.
    if (interval >= 2) await render(true).catch(() => {})
    if (!(await exists(sprite))) await render(false)
  })
  const data = { count, interval, tileWidth, tileHeight: TILE_HEIGHT }
  await writeFileAtomic(meta, JSON.stringify(data))
  return { ...data, url: fileUrl(sprite) }
}

const peakJobs = new Map<string, Promise<Peaks | null>>()

async function buildPeaks(path: string): Promise<Peaks | null> {
  const info = await probe(path)
  if (!info.streams.some((s) => s.kind === 'audio')) return null
  const file = join(await cacheDirFor(path), 'peaks.bin')
  if (await exists(file)) return { perSecond: PEAKS_PER_SECOND, data: new Uint8Array(await readFile(file)) }

  const bucket = PEAK_SAMPLE_RATE / PEAKS_PER_SECOND
  const peaks: number[] = []
  let max = 0
  let filled = 0
  let carry: Buffer | null = null
  await backgroundJobs.run(() =>
    runFfmpeg({
      args: ['-i', path, '-vn', '-sn', '-ac', '1', '-ar', String(PEAK_SAMPLE_RATE), '-f', 's16le', 'pipe:1'],
      onStdout: (chunk) => {
        const data: Buffer = carry ? Buffer.concat([carry, chunk]) : chunk
        const usable = data.length - (data.length % 2)
        for (let i = 0; i < usable; i += 2) {
          const amplitude = Math.abs(data.readInt16LE(i))
          if (amplitude > max) max = amplitude
          if (++filled === bucket) {
            peaks.push(Math.min(255, Math.round((max / 32768) * 255)))
            max = 0
            filled = 0
          }
        }
        carry = usable < data.length ? data.subarray(usable) : null
      }
    })
  )
  const data = Uint8Array.from(peaks)
  await writeFileAtomic(file, data)
  return { perSecond: PEAKS_PER_SECOND, data }
}

const proxyJobs = new Map<string, Promise<string | null>>()

/**
 * Transcodes to H.264/AAC that Chromium always decodes: constant frame rate, rotation baked in,
 * short GOPs for snappy seeking. 'preview' is 720p; 'full' keeps the size at near-lossless quality.
 */
async function buildProxy(path: string, mode: ProxyMode): Promise<string | null> {
  const info = await probe(path)
  const hasVideo = info.streams.some((s) => s.kind === 'video')
  const output = join(await cacheDirFor(path), `proxy-${mode}.${hasVideo ? 'mp4' : 'm4a'}`)
  if (await exists(output)) return output
  const temp = `${output}.partial.${hasVideo ? 'mp4' : 'm4a'}`
  const video = hasVideo
    ? [
        '-map',
        '0:v:0',
        '-vf',
        mode === 'preview' ? "scale=-2:'min(720,ih)'" : 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
        '-fps_mode',
        'cfr',
        '-c:v',
        'libx264',
        '-preset',
        mode === 'preview' ? 'veryfast' : 'fast',
        '-crf',
        mode === 'preview' ? '23' : '14',
        '-g',
        mode === 'preview' ? '15' : '30',
        '-pix_fmt',
        'yuv420p'
      ]
    : []
  await backgroundJobs.run(() =>
    runFfmpeg({
      args: [
        '-y',
        '-i',
        path,
        ...video,
        '-map',
        '0:a:0?',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-sn',
        '-dn',
        '-movflags',
        '+faststart',
        temp
      ]
    })
  )
  await rename(temp, output)
  return output
}

async function directorySize(dir: string): Promise<number> {
  let total = 0
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = join(dir, entry.name)
    total += entry.isDirectory()
      ? await directorySize(full)
      : (await stat(full).catch(() => ({ size: 0 }))).size
  }
  return total
}

async function saveRecording(data: Uint8Array, projectPath: string | null): Promise<string> {
  const dir = projectPath
    ? join(dirname(projectPath), 'Recordings')
    : join(app.getPath('userData'), 'recordings')
  await mkdir(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
  const raw = join(dir, `voiceover-${stamp}.webm`)
  const output = join(dir, `Voiceover ${stamp}.m4a`)
  await writeFile(raw, data)
  // MediaRecorder files have no duration and awkward timestamps; a clean AAC file avoids both.
  await runFfmpeg({ args: ['-y', '-i', raw, '-vn', '-c:a', 'aac', '-b:a', '192k', output] })
  await rm(raw, { force: true })
  return output
}

/** De-duplicates concurrent requests for the same file and forgets failures so they can be retried. */
function once<T>(
  jobs: Map<string, Promise<T | null>>,
  path: string,
  build: () => Promise<T | null>
): Promise<T | null> {
  let job = jobs.get(path)
  if (!job) {
    job = build().catch((error) => {
      console.warn(`[library] ${basename(path)}:`, error)
      jobs.delete(path)
      return null
    })
    jobs.set(path, job)
  }
  return job
}

export function registerLibraryIpc(): void {
  registerFileProtocol()
  ipcMain.handle(LIBRARY_IPC.import, (_e, paths: string[]) => Promise.all(paths.map(importOne)))
  ipcMain.handle(LIBRARY_IPC.exists, (_e, paths: string[]) => Promise.all(paths.map(exists)))
  ipcMain.handle(LIBRARY_IPC.relink, async (e, missingName: string) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const res = await dialog.showOpenDialog(win, {
      title: `Locate “${missingName}”`,
      properties: ['openFile']
    })
    return res.canceled ? null : (res.filePaths[0] ?? null)
  })
  ipcMain.handle(LIBRARY_IPC.fileUrl, (_e, path: string) => {
    allowedFiles.add(resolve(path))
    return fileUrl(path)
  })
  ipcMain.handle(LIBRARY_IPC.filmstrip, (_e, path: string) =>
    once(filmstripJobs, path, () => buildFilmstrip(path))
  )
  ipcMain.handle(LIBRARY_IPC.proxy, (_e, path: string, mode: ProxyMode) =>
    once(proxyJobs, `${mode}:${path}`, () => buildProxy(path, mode))
  )
  ipcMain.handle(LIBRARY_IPC.saveRecording, (_e, data: Uint8Array, projectPath: string | null) =>
    saveRecording(data, projectPath)
  )
  ipcMain.handle(LIBRARY_IPC.cacheSize, () => directorySize(cacheRoot()))
  ipcMain.handle(LIBRARY_IPC.clearCache, async () => {
    await rm(cacheRoot(), { recursive: true, force: true })
    for (const jobs of [filmstripJobs, peakJobs, proxyJobs]) jobs.clear()
  })
  ipcMain.handle(LIBRARY_IPC.peaks, (_e, path: string) => once(peakJobs, path, () => buildPeaks(path)))
}
