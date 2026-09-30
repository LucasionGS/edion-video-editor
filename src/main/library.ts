import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain, net, protocol } from 'electron'
import {
  FILE_PROTOCOL,
  LIBRARY_IPC,
  type Filmstrip,
  type ImportedMedia,
  type MediaProbe,
  type DeriveKind,
  type Peaks,
  type ProxyMode
} from '@shared/ipc'
import { parseEbur128, type Loudness } from '@core/audio/loudness'
import { parseSilences } from '@core/audio/silence'
import { parseSceneTimes } from '@core/ops/retime'
import { backgroundJobs, runFfmpeg } from './ffmpeg/jobs'
import { resolveFfmpeg } from './ffmpeg/paths'
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
  ipcMain.handle(
    LIBRARY_IPC.derive,
    (_e, path: string, kind: DeriveKind, strength: number, projectPath: string | null) =>
      once(deriveJobs, `${kind}:${strength}:${path}`, () => derive(path, kind, strength, projectPath)).then(
        (output) => {
          if (!output)
            throw new Error(`Could not ${kind === 'stabilize' ? 'stabilize' : 'clean up'} the file.`)
          allowedFiles.add(resolve(output))
          return output
        }
      )
  )
  ipcMain.handle(LIBRARY_IPC.scenes, (_e, path: string, start: number, duration: number, threshold: number) =>
    backgroundJobs.run(() => detectScenes(path, start, duration, threshold))
  )
  ipcMain.handle(
    LIBRARY_IPC.silences,
    (_e, path: string, start: number, duration: number, thresholdDb: number, minSeconds: number) =>
      backgroundJobs.run(() => detectSilences(path, start, duration, thresholdDb, minSeconds))
  )
  ipcMain.handle(LIBRARY_IPC.collect, (_e, paths: string[], folder: string) => collectFiles(paths, folder))
  ipcMain.handle(LIBRARY_IPC.loudness, (_e, path: string, start: number, duration: number) =>
    backgroundJobs.run(() => measureLoudness(path, start, duration))
  )
}

/** Runs FFmpeg over `duration` seconds of a file's audio with an analysis filter and returns its log. */
async function analyzeAudio(path: string, start: number, duration: number, filter: string): Promise<string> {
  const { ffmpegPath } = await resolveFfmpeg()
  const args = [
    '-hide_banner',
    '-nostats',
    '-nostdin',
    '-loglevel',
    'info',
    '-ss',
    String(Math.max(0, start))
  ]
  args.push('-t', String(Math.max(0.05, duration)), '-i', path, '-vn', '-af', filter, '-f', 'null', '-')
  return new Promise<string>((resolvePromise) => {
    const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let output = ''
    // Keep the whole log: silencedetect reports every pause, not just a summary.
    child.stderr.on('data', (d: Buffer) => (output += d.toString()))
    child.once('error', () => resolvePromise(''))
    child.once('close', () => resolvePromise(output))
  })
}

async function measureLoudness(path: string, start: number, duration: number): Promise<Loudness | null> {
  return parseEbur128(await analyzeAudio(path, start, duration, 'ebur128=peak=true'))
}

/** Frame times (source seconds) where the picture changes by more than `threshold` (0-1). */
async function detectScenes(
  path: string,
  start: number,
  duration: number,
  threshold: number
): Promise<number[]> {
  const { ffmpegPath } = await resolveFfmpeg()
  const args = [
    '-hide_banner',
    '-nostats',
    '-nostdin',
    '-loglevel',
    'info',
    '-ss',
    String(Math.max(0, start))
  ]
  // Scaled down first: the scene score only needs a rough picture, and it is much faster.
  args.push(
    '-t',
    String(duration),
    '-i',
    path,
    '-an',
    '-vf',
    `scale=320:-2,select='gt(scene,${threshold})',showinfo`
  )
  args.push('-f', 'null', '-')
  const log = await new Promise<string>((resolvePromise) => {
    const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let output = ''
    child.stderr.on('data', (d: Buffer) => (output += d.toString()))
    child.once('error', () => resolvePromise(''))
    child.once('close', () => resolvePromise(output))
  })
  return parseSceneTimes(log, start)
}

async function detectSilences(
  path: string,
  start: number,
  duration: number,
  thresholdDb: number,
  minSeconds: number
): Promise<Array<[number, number]>> {
  const log = await analyzeAudio(
    path,
    start,
    duration,
    `silencedetect=noise=${thresholdDb}dB:d=${minSeconds}`
  )
  return parseSilences(log, start, duration)
}

async function collectFiles(paths: string[], folder: string): Promise<Record<string, string>> {
  await mkdir(folder, { recursive: true })
  const moved: Record<string, string> = {}
  const taken = new Set((await readdir(folder)).map((name) => name.toLowerCase()))
  for (const path of new Set(paths)) {
    if (resolve(dirname(path)) === resolve(folder)) continue
    const extension = extname(path)
    const stem = basename(path, extension)
    let name = basename(path)
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${stem} (${n})${extension}`
    taken.add(name.toLowerCase())
    const target = join(folder, name)
    await copyFile(path, target)
    allowedFiles.add(resolve(target))
    moved[path] = target
  }
  return moved
}

const deriveJobs = new Map<string, Promise<string | null>>()

/**
 * A processed copy of a whole media file, so it keeps the original's timing and clips can switch to it.
 * Stabilisation is vid.stab's two passes (motion analysis, then smoothing with an automatic zoom to hide
 * the moving edges); noise reduction is FFmpeg's FFT denoiser plus a rumble filter, saved losslessly.
 */
async function derive(
  path: string,
  kind: DeriveKind,
  strength: number,
  projectPath: string | null
): Promise<string> {
  const dir = projectPath
    ? join(dirname(projectPath), 'Processed')
    : join(app.getPath('userData'), 'processed')
  await mkdir(dir, { recursive: true })
  const stem = basename(path, extname(path))
  const level = Math.round(Math.max(1, Math.min(100, strength)))
  const output = join(
    dir,
    `${stem} (${kind === 'stabilize' ? 'stabilized' : 'denoised'} ${level}).${kind === 'stabilize' ? 'mp4' : 'flac'}`
  )
  if (await exists(output)) return output
  const temp = `${output}.partial${extname(output)}`
  if (kind === 'stabilize') {
    const transforms = join(await cacheDirFor(path), `stabilize-${Date.now()}.trf`)
    // vid.stab parses its options with ':' separators, so the path's own colons (Windows) must be escaped.
    const trf = transforms.replace(/\\/g, '/').replace(/:/g, '\\:')
    await backgroundJobs.run(() =>
      runFfmpeg({
        args: [
          '-y',
          '-i',
          path,
          '-vf',
          `vidstabdetect=shakiness=6:accuracy=15:result='${trf}'`,
          '-f',
          'null',
          '-'
        ]
      })
    )
    const smoothing = Math.round(5 + (level / 100) * 55)
    await backgroundJobs.run(() =>
      runFfmpeg({
        args: [
          '-y',
          '-i',
          path,
          '-map',
          '0:v:0',
          '-map',
          '0:a:0?',
          '-vf',
          `vidstabtransform=input='${trf}':smoothing=${smoothing}:optzoom=1:interpol=bicubic,unsharp=5:5:0.6:3:3:0.3,format=yuv420p`,
          '-c:v',
          'libx264',
          '-preset',
          'fast',
          '-crf',
          '14',
          '-c:a',
          'aac',
          '-b:a',
          '256k',
          '-movflags',
          '+faststart',
          temp
        ]
      })
    )
    await rm(transforms, { force: true })
  } else {
    // nr: dB of reduction (6-30); nf: the noise floor it assumes.
    const reduction = Math.round(6 + (level / 100) * 24)
    await backgroundJobs.run(() =>
      runFfmpeg({
        args: [
          '-y',
          '-i',
          path,
          '-vn',
          '-af',
          `highpass=f=70,afftdn=nr=${reduction}:nf=-45:tn=1`,
          '-c:a',
          'flac',
          temp
        ]
      })
    )
  }
  await rename(temp, output)
  return output
}
