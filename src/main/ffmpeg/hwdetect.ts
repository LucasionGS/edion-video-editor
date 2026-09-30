import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'
import type { VideoCodec } from '@shared/formats'
import type { ExportQuality, ResolvedEncoder } from '@shared/ipc'
import { resolveFfmpeg, systemFfmpeg } from './paths'

const exec = promisify(execFile)
const VAAPI_DEVICE = '/dev/dri/renderD128'

type Template = Omit<ResolvedEncoder, 'ffmpegPath' | 'codec'>
const q = (high: string[], medium: string[], low: string[]): Record<ExportQuality, string[]> => ({
  high,
  medium,
  low
})
const crf = (flag: string, [high, medium, low]: [number, number, number], extra: string[] = []) =>
  q([...extra, flag, String(high)], [...extra, flag, String(medium)], [...extra, flag, String(low)])
const software = (
  name: string,
  label: string,
  codecArgs: Template['codecArgs'],
  pixelFormat = 'yuv420p'
): Template => ({
  name,
  label,
  hardware: false,
  globalArgs: [],
  filterSuffix: '',
  pixelFormat,
  codecArgs
})

/** Software encoders per codec, best first; the first one this FFmpeg has is used. */
const SOFTWARE: Record<VideoCodec, Template[]> = {
  h264: [
    software(
      'libx264',
      'Software (x264)',
      q(
        ['-preset', 'medium', '-crf', '17'],
        ['-preset', 'medium', '-crf', '21'],
        ['-preset', 'fast', '-crf', '26']
      )
    )
  ],
  hevc: [
    software(
      'libx265',
      'Software (x265)',
      crf('-crf', [20, 24, 28], ['-preset', 'medium', '-x265-params', 'log-level=error'])
    )
  ],
  av1: [
    software('libsvtav1', 'Software (SVT-AV1)', crf('-crf', [28, 34, 42], ['-preset', '8'])),
    software(
      'libaom-av1',
      'Software (libaom)',
      crf('-crf', [28, 34, 42], ['-cpu-used', '6', '-row-mt', '1', '-b:v', '0'])
    )
  ],
  vp9: [
    software(
      'libvpx-vp9',
      'Software (libvpx)',
      crf('-crf', [24, 31, 38], ['-deadline', 'good', '-cpu-used', '4', '-row-mt', '1', '-b:v', '0'])
    )
  ],
  prores: [
    software(
      'prores_ks',
      'Software (ProRes)',
      q(
        ['-profile:v', '3', '-vendor', 'apl0'],
        ['-profile:v', '2', '-vendor', 'apl0'],
        ['-profile:v', '1', '-vendor', 'apl0']
      ),
      'yuv422p10le'
    )
  ],
  gif: [software('gif', 'GIF', q([], [], []), 'pal8')],
  png: [software('png', 'PNG', q([], [], []), 'rgb24')]
}

/** GPU encoders; `{codec}` becomes h264 / hevc / av1. Not every vendor encodes every codec. */
const HARDWARE: Record<string, Array<Template & { codecs: VideoCodec[] }>> = {
  all: [
    {
      name: '{codec}_nvenc',
      label: 'NVIDIA NVENC',
      codecs: ['h264', 'hevc', 'av1'],
      hardware: true,
      globalArgs: [],
      filterSuffix: '',
      pixelFormat: 'yuv420p',
      codecArgs: q(
        ['-preset', 'p6', '-rc', 'vbr', '-cq', '19', '-b:v', '0'],
        ['-preset', 'p5', '-rc', 'vbr', '-cq', '23', '-b:v', '0'],
        ['-preset', 'p4', '-rc', 'vbr', '-cq', '28', '-b:v', '0']
      )
    },
    {
      name: '{codec}_qsv',
      label: 'Intel Quick Sync',
      codecs: ['h264', 'hevc', 'av1'],
      hardware: true,
      globalArgs: [],
      filterSuffix: '',
      pixelFormat: 'nv12',
      codecArgs: q(['-global_quality', '19'], ['-global_quality', '23'], ['-global_quality', '28'])
    }
  ],
  linux: [
    {
      name: '{codec}_vaapi',
      label: 'VAAPI (GPU)',
      codecs: ['h264', 'hevc', 'av1'],
      hardware: true,
      globalArgs: ['-vaapi_device', VAAPI_DEVICE],
      filterSuffix: ',format=nv12,hwupload',
      pixelFormat: null,
      codecArgs: q(
        ['-rc_mode', 'CQP', '-qp', '19'],
        ['-rc_mode', 'CQP', '-qp', '23'],
        ['-rc_mode', 'CQP', '-qp', '28']
      )
    }
  ],
  win32: [
    {
      name: '{codec}_amf',
      label: 'AMD AMF',
      codecs: ['h264', 'hevc', 'av1'],
      hardware: true,
      globalArgs: [],
      filterSuffix: '',
      pixelFormat: 'yuv420p',
      codecArgs: q(
        ['-quality', 'quality', '-rc', 'cqp', '-qp_i', '18', '-qp_p', '20'],
        ['-quality', 'balanced', '-rc', 'cqp', '-qp_i', '22', '-qp_p', '24'],
        ['-quality', 'speed', '-rc', 'cqp', '-qp_i', '27', '-qp_p', '29']
      )
    }
  ],
  darwin: [
    {
      name: '{codec}_videotoolbox',
      label: 'Apple VideoToolbox',
      codecs: ['h264', 'hevc'],
      hardware: true,
      globalArgs: [],
      filterSuffix: '',
      pixelFormat: 'yuv420p',
      codecArgs: q(['-q:v', '70'], ['-q:v', '58'], ['-q:v', '45'])
    }
  ]
}

/** Listing an encoder proves nothing (no GPU, no driver…), so each candidate has to encode a few real frames. */
async function works(ffmpegPath: string, encoder: Template): Promise<boolean> {
  if (encoder.name.endsWith('_vaapi') && !existsSync(VAAPI_DEVICE)) return false
  try {
    await exec(
      ffmpegPath,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        ...encoder.globalArgs,
        '-f',
        'lavfi',
        '-i',
        'color=c=black:s=640x360:r=30:d=0.2',
        '-vf',
        `format=${encoder.pixelFormat ?? 'nv12'}${encoder.pixelFormat ? '' : ',hwupload'}`,
        '-c:v',
        encoder.name,
        ...encoder.codecArgs.medium,
        '-f',
        'null',
        '-'
      ],
      { timeout: 15000 }
    )
    return true
  } catch {
    return false
  }
}

const listings = new Map<string, Promise<string>>()
/** `ffmpeg -encoders` output, fetched once per binary. */
function encoderList(ffmpegPath: string): Promise<string> {
  let listing = listings.get(ffmpegPath)
  if (!listing) {
    listing = exec(ffmpegPath, ['-hide_banner', '-encoders']).then(
      (r) => r.stdout,
      () => ''
    )
    listings.set(ffmpegPath, listing)
  }
  return listing
}

async function firstWorking(binaries: string[], encoder: Template): Promise<string | null> {
  for (const ffmpegPath of binaries) {
    const listed = (await encoderList(ffmpegPath)).includes(` ${encoder.name} `)
    if (listed && (await works(ffmpegPath, encoder))) return ffmpegPath
  }
  return null
}

const detections = new Map<VideoCodec, Promise<ResolvedEncoder[]>>()

/**
 * Working encoders for a codec, hardware first, software last (when this FFmpeg has one). Static builds
 * rarely include GPU encoders, so the system FFmpeg is probed too.
 */
export function detectEncoders(codec: VideoCodec = 'h264'): Promise<ResolvedEncoder[]> {
  let detection = detections.get(codec)
  if (detection) return detection
  detection = (async () => {
    const primary = (await resolveFfmpeg()).ffmpegPath
    const system = await systemFfmpeg()
    const binaries = [...new Set([primary, ...(system ? [system] : [])])]
    const candidates = [...(HARDWARE[process.platform] ?? []), ...HARDWARE['all']!]
      .filter((c) => c.codecs.includes(codec))
      .map(({ codecs: _codecs, ...template }) => ({
        ...template,
        name: template.name.replace('{codec}', codec)
      }))
    const found: ResolvedEncoder[] = []
    for (const encoder of candidates) {
      const ffmpegPath = await firstWorking(binaries, encoder)
      if (ffmpegPath) found.push({ ...encoder, ffmpegPath, codec })
    }
    // NVENC beats the generic APIs when several work.
    found.sort((a, b) => Number(b.name.includes('nvenc')) - Number(a.name.includes('nvenc')))
    // Software: prefer the bundled binary, whose output is what the tests verify.
    for (const encoder of SOFTWARE[codec]) {
      const ffmpegPath = await firstWorking(binaries, encoder)
      if (ffmpegPath) {
        found.push({ ...encoder, ffmpegPath, codec })
        break
      }
    }
    return found
  })()
  detections.set(codec, detection)
  return detection
}

export const resetEncoderDetection = (): void => {
  detections.clear()
  listings.clear()
}
