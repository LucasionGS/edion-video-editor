import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { createWriteStream, type WriteStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { contextBridge, ipcRenderer } from 'electron'
import { ffmpegArgs } from '@shared/ffmpegArgs'
import { EXPORT_IPC, IPC, LIBRARY_IPC, type EdionExportApi, type FfmpegInfo } from '@shared/ipc'
import { mediaApi } from './media'

const jobId = decodeURIComponent(
  (globalThis as unknown as { location: { hash: string } }).location.hash.slice(1)
)

let encoder: ChildProcess | null = null
let encoderExit: Promise<number | null> | null = null
let outputPath: string | null = null
let stderrTail = ''
let tempDir: string | null = null
let audioStream: WriteStream | null = null

async function discardEncoder(): Promise<void> {
  if (encoder && encoder.exitCode === null) {
    encoder.kill('SIGKILL')
    await encoderExit?.catch(() => null)
  }
  encoder = null
  if (outputPath) await rm(outputPath, { force: true })
}

async function cleanup(): Promise<void> {
  audioStream?.destroy()
  if (tempDir) await rm(tempDir, { recursive: true, force: true })
  tempDir = null
}

const api: EdionExportApi = {
  media: mediaApi,
  library: {
    fileUrl: (path) => ipcRenderer.invoke(LIBRARY_IPC.fileUrl, path),
    proxy: (path, mode) => ipcRenderer.invoke(LIBRARY_IPC.proxy, path, mode)
  },
  getJob: () => ipcRenderer.invoke(EXPORT_IPC.getJob, jobId),

  async beginAudio() {
    tempDir ??= await mkdtemp(join(tmpdir(), 'edion-export-'))
    const path = join(tempDir, 'mix.f32')
    audioStream = createWriteStream(path)
    return path
  },
  async appendAudio(interleaved) {
    if (!audioStream) throw new Error('Audio file is not open')
    const bytes = Buffer.from(interleaved.buffer, interleaved.byteOffset, interleaved.byteLength)
    if (!audioStream.write(bytes)) await once(audioStream, 'drain')
  },
  async endAudio() {
    const stream = audioStream
    audioStream = null
    if (stream)
      await new Promise<void>((resolve, reject) =>
        stream.end((error?: Error | null) => (error ? reject(error) : resolve()))
      )
  },

  async startEncoder(start) {
    outputPath = start.outputPath
    stderrTail = ''
    const args = ffmpegArgs(start)
    const ffmpeg =
      start.encoder?.ffmpegPath ?? ((await ipcRenderer.invoke(IPC.ffmpegInfo)) as FfmpegInfo).ffmpegPath
    const child = spawn(ffmpeg, args, { stdio: ['pipe', 'ignore', 'pipe'] })
    encoder = child
    child.stderr?.on('data', (d: Buffer) => (stderrTail = (stderrTail + d.toString()).slice(-1500)))
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
    if (!encoder || !stdin || encoder.exitCode !== null || stdin.destroyed) {
      throw new Error(`The encoder stopped unexpectedly. ${stderrTail.trim()}`)
    }
    if (!stdin.write(rgba)) await Promise.race([once(stdin, 'drain'), encoderExit])
  },

  async finish() {
    encoder?.stdin?.end()
    const code = await encoderExit
    encoder = null
    if (code !== 0) throw new Error(`FFmpeg exited with code ${code}. ${stderrTail.trim()}`)
  },

  discardEncoder,
  cleanup,
  progress: (p) => ipcRenderer.send(EXPORT_IPC.progress, jobId, p),
  onAbort: (cb) => void ipcRenderer.on(EXPORT_IPC.abort, cb)
}

contextBridge.exposeInMainWorld('edionExport', api)
