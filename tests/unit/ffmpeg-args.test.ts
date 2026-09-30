import { describe, expect, it } from 'vitest'
import { ffmpegArgs } from '@shared/ffmpegArgs'
import { EXPORT_FORMATS, formatForPath } from '@shared/formats'
import type { EncoderStart, ResolvedEncoder } from '@shared/ipc'

const encoder = (name: string, pixelFormat: string | null = 'yuv420p'): ResolvedEncoder => ({
  name,
  label: name,
  hardware: false,
  codec: 'h264',
  ffmpegPath: 'ffmpeg',
  globalArgs: [],
  filterSuffix: '',
  pixelFormat,
  codecArgs: { high: ['-crf', '17'], medium: ['-crf', '21'], low: ['-crf', '26'] }
})

const base: EncoderStart = {
  width: 1280,
  height: 720,
  fps: '30/1',
  outputPath: '/out/file',
  format: 'mp4-h264',
  encoder: encoder('libx264'),
  quality: 'high',
  audio: { path: '/tmp/mix.f32', sampleRate: 48000, bitrateKbps: 192 }
}

/** The value following a flag (the last occurrence). */
function flag(args: string[], name: string): string | undefined {
  const i = args.lastIndexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

describe('ffmpeg arguments', () => {
  it('encodes H.264 + AAC in MP4 with BT.709 tags', () => {
    const args = ffmpegArgs(base)
    expect(flag(args, '-c:v')).toBe('libx264')
    expect(flag(args, '-crf')).toBe('17')
    expect(flag(args, '-c:a')).toBe('aac')
    expect(flag(args, '-b:a')).toBe('192k')
    expect(flag(args, '-colorspace')).toBe('bt709')
    expect(args).toContain('+faststart')
    expect(args).toContain('-shortest')
    expect(args.at(-1)).toBe('/out/file')
  })

  it('tags HEVC as hvc1', () => {
    const args = ffmpegArgs({ ...base, format: 'mp4-hevc', encoder: encoder('libx265') })
    expect(flag(args, '-tag:v')).toBe('hvc1')
  })

  it('uses Opus in WebM and PCM in MOV, without faststart for WebM', () => {
    const webm = ffmpegArgs({ ...base, format: 'webm-vp9', encoder: encoder('libvpx-vp9') })
    expect(flag(webm, '-c:a')).toBe('libopus')
    expect(webm).not.toContain('+faststart')
    const mov = ffmpegArgs({ ...base, format: 'mov-prores', encoder: encoder('prores_ks', 'yuv422p10le') })
    expect(flag(mov, '-c:a')).toBe('pcm_s16le')
    expect(flag(mov, '-pix_fmt')).toBe('yuv422p10le')
    expect(mov).not.toContain('-b:a')
  })

  it('builds a palette for GIFs, drops audio and limits the frame rate by quality', () => {
    const high = ffmpegArgs({ ...base, format: 'gif', fps: '60/1', encoder: encoder('gif', 'pal8') })
    expect(flag(high, '-c:v')).toBe('gif')
    expect(flag(high, '-vf')).toMatch(/^fps=30,.*palettegen.*paletteuse/)
    expect(high).not.toContain('-c:a')
    expect(high).not.toContain('/tmp/mix.f32')
    const low = ffmpegArgs({ ...base, format: 'gif', quality: 'low', encoder: encoder('gif', 'pal8') })
    expect(flag(low, '-vf')).toMatch(/^fps=12,.*max_colors=128/)
  })

  it('writes a single PNG frame', () => {
    const args = ffmpegArgs({ ...base, format: 'png', encoder: encoder('png', 'rgb24') })
    expect(flag(args, '-frames:v')).toBe('1')
    expect(flag(args, '-c:v')).toBe('png')
    expect(args).not.toContain('-colorspace')
  })

  it('encodes audio-only formats without a video input', () => {
    const mp3 = ffmpegArgs({ ...base, format: 'mp3', encoder: null })
    expect(mp3).not.toContain('pipe:0')
    expect(mp3).toContain('-nostdin')
    expect(flag(mp3, '-map')).toBe('0:a:0')
    expect(flag(mp3, '-c:a')).toBe('libmp3lame')
    expect(mp3).not.toContain('-shortest')
    expect(flag(ffmpegArgs({ ...base, format: 'flac', encoder: null }), '-c:a')).toBe('flac')
  })

  it('omits the audio input for silent projects', () => {
    const args = ffmpegArgs({ ...base, audio: null })
    expect(args).not.toContain('-c:a')
    expect(args).not.toContain('-shortest')
  })
})

describe('formats', () => {
  it('guesses the format from the extension', () => {
    expect(formatForPath('/a/b.webm')).toBe('webm-vp9')
    expect(formatForPath('/a/b.MP4')).toBe('mp4-h264')
    expect(formatForPath('/a/b.gif')).toBe('gif')
    expect(formatForPath('/a/b.unknown')).toBe('mp4-h264')
  })
  it('has unique ids', () => {
    expect(new Set(EXPORT_FORMATS.map((f) => f.id)).size).toBe(EXPORT_FORMATS.length)
  })
})
