import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { rm } from 'node:fs/promises'
import { contextBridge, ipcRenderer } from 'electron'
import { EXPORT_IPC, type EdionExportApi, type ExportJob } from '@shared/ipc'
import { mediaApi } from './media'

const jobId = decodeURIComponent(
  (globalThis as unknown as { location: { hash: string } }).location.hash.slice(1)
)
const jobInfo: Promise<{ job: ExportJob; ffmpegPath: string }> = ipcRenderer.invoke(EXPORT_IPC.getJob, jobId)

let encoder: ChildProcess | null = null
let encoderExit: Promise<number | null> | null = null
let outputPath: string | null = null
let stderrTail = ''

async function killEncoder(): Promise<void> {
  if (encoder && encoder.exitCode === null) {
    encoder.kill('SIGKILL')
    await encoderExit?.catch(() => null)
  }
  if (outputPath) await rm(outputPath, { force: true })
}

const api: EdionExportApi = {
  media: mediaApi,
  getJob: async () => (await jobInfo).job,

  async startEncoder(opts) {
    const { ffmpegPath } = await jobInfo
    outputPath = opts.outputPath
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgba',
      '-s',
      `${opts.width}x${opts.height}`,
      '-r',
      String(opts.fps),
      '-i',
      'pipe:0'
    ]
    if (opts.audioPath) args.push('-i', opts.audioPath)
    args.push('-map', '0:v:0')
    if (opts.audioPath) args.push('-map', '1:a?', '-c:a', 'aac', '-b:a', '192k')
    args.push(
      '-c:v',
      opts.videoCodec ?? 'libx264',
      ...(opts.videoArgs ?? ['-preset', 'medium', '-crf', '18']),
      // The compositor works in sRGB/BT.709; convert and tag explicitly so players don't guess.
      '-vf',
      'scale=out_color_matrix=bt709:out_range=tv',
      '-colorspace',
      'bt709',
      '-color_primaries',
      'bt709',
      '-color_trc',
      'bt709',
      '-color_range',
      'tv',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      '-shortest',
      opts.outputPath
    )
    const child = spawn(ffmpegPath, args, { stdio: ['pipe', 'ignore', 'pipe'] })
    encoder = child
    child.stderr?.on('data', (d: Buffer) => {
      stderrTail = (stderrTail + d.toString()).slice(-2000)
    })
    // EPIPE when FFmpeg dies early; the exit code carries the real error.
    child.stdin?.on('error', () => {})
    encoderExit = new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('close', (code) => resolve(code))
    })
    await once(child, 'spawn')
  },

  async writeFrame(rgba) {
    const stdin = encoder?.stdin
    if (!stdin || encoder?.exitCode !== null || stdin.destroyed) {
      throw new Error(`FFmpeg is not running. ${stderrTail}`)
    }
    if (!stdin.write(rgba)) {
      await Promise.race([once(stdin, 'drain'), encoderExit])
    }
  },

  async finish() {
    encoder?.stdin?.end()
    const code = await encoderExit
    if (code !== 0) throw new Error(`FFmpeg exited with code ${code}. ${stderrTail}`)
  },

  progress: (p) => ipcRenderer.send(EXPORT_IPC.progress, { ...p, jobId }),

  onAbort(cb) {
    ipcRenderer.on(EXPORT_IPC.abort, () => {
      cb()
      void killEncoder().finally(() => {
        ipcRenderer.send(EXPORT_IPC.progress, { jobId, frame: 0, totalFrames: 0, state: 'cancelled' })
      })
    })
  }
}

contextBridge.exposeInMainWorld('edionExport', api)
