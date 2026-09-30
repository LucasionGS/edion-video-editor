import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  addMedia,
  createAdjustmentClip,
  EFFECTS,
  clipFromMedia,
  createProject,
  createShapeClip,
  insertClip,
  insertClipAuto,
  insertFrameHold,
  newId,
  serializeProject,
  setReversed,
  setTransition,
  splitClip
} from '@core/index'
import type { MediaAsset, Project, VideoClip } from '@core/index'

const electron = createRequire(import.meta.url)('electron') as unknown as string
const root = resolve(import.meta.dirname, '../..')
const fixture = join(root, 'tests/fixtures/testsrc-720p30.mp4')
const SECONDS = 4
const FPS = 30
let workDir: string

function ensureFixture(): void {
  if (existsSync(fixture)) return
  mkdirSync(join(root, 'tests/fixtures'), { recursive: true })
  execFileSync('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `testsrc2=size=1280x720:rate=${FPS}:duration=${SECONDS}`,
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=440:duration=${SECONDS}`,
    '-vf',
    'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
    '-colorspace',
    'bt709',
    '-color_primaries',
    'bt709',
    '-color_trc',
    'bt709',
    '-color_range',
    'tv',
    '-c:v',
    'libx264',
    '-crf',
    '12',
    '-c:a',
    'aac',
    '-shortest',
    fixture
  ])
}

function baseProject(): { project: Project; asset: MediaAsset; clip: VideoClip } {
  const project = createProject('e2e', { width: 1280, height: 720, fps: FPS })
  const asset: MediaAsset = {
    id: newId(),
    kind: 'video',
    name: 'testsrc',
    path: fixture,
    size: 0,
    duration: SECONDS,
    width: 1280,
    height: 720,
    fps: FPS,
    hasAudio: true
  }
  addMedia(project, asset)
  const clip = clipFromMedia(asset, 0, FPS) as VideoClip
  insertClip(project, project.tracks[0]!.id, clip)
  return { project, asset, clip }
}

function exportProject(project: Project, name: string, extension = 'mp4', format?: string): string {
  const projectPath = join(workDir, `${name}.edion`)
  const output = join(workDir, `${name}.${extension}`)
  writeFileSync(projectPath, serializeProject(project))
  // CI runners restrict user namespaces and npm cannot install Chromium's setuid sandbox helper, so the
  // app would abort at startup. The pages under test are our own, so the sandbox buys nothing here.
  // EDION_E2E_NO_GPU=1 reproduces a GPU-less runner locally (software WebGL via SwiftShader).
  const flags = [
    ...(process.env['CI'] ? ['--no-sandbox'] : []),
    ...(process.env['EDION_E2E_NO_GPU'] ? ['--disable-gpu'] : [])
  ]
  const run = spawnSync(electron, [root, ...flags], {
    env: {
      ...process.env,
      EDION_HEADLESS_EXPORT: `${projectPath}::${output}${format ? `::software::${format}` : ''}`,
      EDION_DEBUG_EXPORT: '1'
    },
    timeout: 150_000,
    encoding: 'utf8'
  })
  if (run.status !== 0) throw new Error(`export failed (${run.status})\n${run.stdout}\n${run.stderr}`)
  // EDION_E2E_KEEP=<dir> keeps the rendered files for inspection.
  if (process.env['EDION_E2E_KEEP'])
    copyFileSync(output, join(process.env['EDION_E2E_KEEP'], `${name}.${extension}`))
  return output
}

function probe(path: string): { video?: Record<string, string>; audio?: Record<string, string> } {
  const { streams } = JSON.parse(
    execFileSync(
      'ffprobe',
      ['-v', 'error', '-print_format', 'json', '-show_streams', '-count_frames', path],
      { encoding: 'utf8' }
    )
  ) as { streams: Array<Record<string, string>> }
  return {
    video: streams.find((s) => s['codec_type'] === 'video'),
    audio: streams.find((s) => s['codec_type'] === 'audio')
  }
}

/** RGB of one pixel of one frame. */
function pixel(path: string, frame: number, x: number, y: number): [number, number, number] {
  const raw = execFileSync('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    path,
    '-vf',
    `select=eq(n\\,${frame}),scale=in_color_matrix=bt709,format=rgb24,crop=1:1:${x}:${y}`,
    '-frames:v',
    '1',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgb24',
    '-'
  ])
  return [raw[0]!, raw[1]!, raw[2]!]
}

function psnr(a: string, b: string): number {
  const { stderr } = spawnSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-i',
      a,
      '-i',
      b,
      // Compare frame n with frame n: containers with millisecond timestamps (WebM) would otherwise pair
      // every third frame with its predecessor.
      '-lavfi',
      '[0:v]settb=1/30,setpts=N[a];[1:v]settb=1/30,setpts=N[b];[a][b]psnr=shortest=1',
      '-f',
      'null',
      '-'
    ],
    { encoding: 'utf8' }
  )
  return Number(stderr.match(/average:([\d.]+)/)?.[1] ?? 0)
}

/** PSNR between frame `frameA` of `a` and frame `frameB` of `b`. */
function framePsnr(a: string, frameA: number, b: string, frameB: number): number {
  const { stderr } = spawnSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-i',
      a,
      '-i',
      b,
      '-lavfi',
      `[0:v]select=eq(n\\,${frameA}),setpts=0[a];[1:v]select=eq(n\\,${frameB}),setpts=0[b];[a][b]psnr`,
      '-frames:v',
      '1',
      '-f',
      'null',
      '-'
    ],
    { encoding: 'utf8' }
  )
  const value = stderr.match(/average:([\d.]+|inf)/)?.[1]
  return value === 'inf' ? Infinity : Number(value ?? 0)
}

beforeAll(() => {
  ensureFixture()
  workDir = mkdtempSync(join(tmpdir(), 'edion-e2e-'))
})
afterAll(() => rmSync(workDir, { recursive: true, force: true }))

describe('export', () => {
  it('reproduces an untouched clip faithfully', () => {
    const output = exportProject(baseProject().project, 'passthrough')
    const { video, audio } = probe(output)
    expect(video!['codec_name']).toBe('h264')
    expect([video!['width'], video!['height']]).toEqual([1280, 720])
    expect(video!['r_frame_rate']).toBe(`${FPS}/1`)
    expect(Number(video!['nb_read_frames'])).toBe(SECONDS * FPS)
    expect(video!['color_space']).toBe('bt709')
    expect(audio?.['codec_name']).toBe('aac')
    expect(Math.abs(Number(audio?.['duration']) - SECONDS)).toBeLessThan(0.1)
    expect(psnr(output, fixture)).toBeGreaterThan(35)
  })

  it('exports sources Chromium cannot decode through an intermediate', () => {
    const prores = join(workDir, 'prores.mov')
    execFileSync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      fixture,
      '-t',
      '1',
      '-c:v',
      'prores_ks',
      '-profile:v',
      '0',
      '-c:a',
      'pcm_s16le',
      prores
    ])
    const { project, asset, clip } = baseProject()
    asset.path = prores
    asset.duration = 1
    clip.duration = FPS
    const output = exportProject(project, 'prores')
    const { video, audio } = probe(output)
    expect(Number(video!['nb_read_frames'])).toBe(FPS)
    expect(audio?.['codec_name']).toBe('aac')
    expect(psnr(output, fixture)).toBeGreaterThan(30)
  })

  it('composites still images', () => {
    const still = join(root, 'tests/fixtures/still.png')
    execFileSync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=0x00ff00:s=400x400',
      '-frames:v',
      '1',
      still
    ])
    const { project } = baseProject()
    const asset: MediaAsset = {
      id: newId(),
      kind: 'image',
      name: 'still',
      path: still,
      size: 0,
      duration: 0,
      width: 400,
      height: 400,
      hasAudio: false
    }
    addMedia(project, asset)
    const clip = clipFromMedia(asset, 0, FPS)
    clip.duration = 30
    insertClipAuto(project, clip)
    writeFileSync(join(root, 'tests/fixtures/still.edion'), serializeProject(project))
    const output = exportProject(project, 'still')
    // A square still is fitted to the frame height and centred: green in the middle, video at the sides.
    const [r, g, b] = pixel(output, 10, 640, 360)
    expect(g).toBeGreaterThan(200)
    expect(Math.max(r, b)).toBeLessThan(60)
    const [r2, g2, b2] = pixel(output, 45, 640, 360)
    expect(g2 > 200 && Math.max(r2, b2) < 60).toBe(false)
  })

  it('renders cuts, transitions, overlays and effects', () => {
    const { project, clip } = baseProject()
    const rightId = splitClip(project, clip.id, 60)!
    expect(setTransition(project, clip.id, 'crossfade', 20)).not.toBeNull()
    expect(rightId).toBeTruthy()
    clip.effects.push({ id: newId(), type: 'color', enabled: true, params: { saturation: { value: -1 } } })

    const square = createShapeClip(0, FPS, 'rect')
    square.duration = 90
    square.size = [200, 200]
    square.fill = '#ffffff'
    square.transform.position.value = [-400, 0]
    insertClipAuto(project, square)

    // Kept around as a handy project for manual and screenshot checks.
    writeFileSync(join(root, 'tests/fixtures/demo.edion'), serializeProject(project))
    const output = exportProject(project, 'composited')
    expect(Number(probe(output).video!['nb_read_frames'])).toBe(SECONDS * FPS)

    // The white square sits 400px left of centre while it lasts…
    const [r, g, b] = pixel(output, 30, 240, 360)
    expect(Math.min(r, g, b)).toBeGreaterThan(235)
    // …and is gone afterwards.
    const after = pixel(output, 100, 240, 360)
    expect(Math.min(...after)).toBeLessThan(235)
    // The first half is desaturated by the colour effect: a pixel of the colourful test pattern turns grey.
    const [gr, gg, gb] = pixel(output, 30, 900, 500)
    expect(Math.max(gr, gg, gb) - Math.min(gr, gg, gb)).toBeLessThan(12)
    const [cr, cg, cb] = pixel(output, 100, 900, 500)
    expect(Math.max(cr, cg, cb) - Math.min(cr, cg, cb)).toBeGreaterThan(12)
  })
})

describe('time', () => {
  it('plays reversed clips backwards, frame for frame', () => {
    const { project, clip } = baseProject()
    setReversed(project, clip.id, true)
    const started = Date.now()
    const output = exportProject(project, 'reversed')
    console.log(`reversed export took ${Date.now() - started} ms`)
    const last = SECONDS * FPS - 1
    expect(Number(probe(output).video!['nb_read_frames'])).toBe(SECONDS * FPS)
    for (const n of [0, 1, 40, 77, last]) expect(framePsnr(output, n, fixture, last - n)).toBeGreaterThan(35)
    // Sanity check: the forward frame at the same index is different.
    expect(framePsnr(output, 0, fixture, 0)).toBeLessThan(25)
  })

  it('holds a frame', () => {
    const { project, clip } = baseProject()
    clip.duration = 30
    const holdId = insertFrameHold(project, clip.id, 10, 20)!
    expect(holdId).toBeTruthy()
    const output = exportProject(project, 'hold')
    expect(Number(probe(output).video!['nb_read_frames'])).toBe(50)
    for (const n of [10, 20, 29]) expect(framePsnr(output, n, fixture, 10)).toBeGreaterThan(35)
    // After the hold the clip carries on where it stopped.
    expect(framePsnr(output, 30, fixture, 10)).toBeGreaterThan(35)
    expect(framePsnr(output, 35, fixture, 15)).toBeGreaterThan(35)
  })
})

/** Mean volume in dB of one channel (0 = left, 1 = right) of a file's audio. */
function channelVolume(path: string, channel: 0 | 1): number {
  const { stderr } = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-i', path, '-af', `pan=mono|c0=c${channel},volumedetect`, '-f', 'null', '-'],
    { encoding: 'utf8' }
  )
  const value = stderr.match(/mean_volume:\s*(-?[\d.]+|-inf)/)?.[1]
  return value === undefined || value === '-inf' ? -Infinity : Number(value)
}

describe('compositing', () => {
  const effect = (type: string, params: Record<string, number>) => ({
    id: newId(),
    type,
    enabled: true,
    params: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, { value: v }]))
  })
  const spread = ([r, g, b]: [number, number, number]): number => Math.max(r, g, b) - Math.min(r, g, b)

  it('applies adjustment layers to everything below, masked', () => {
    const { project } = baseProject()
    const adjustment = createAdjustmentClip(0, FPS)
    adjustment.duration = 60
    adjustment.effects.push(
      effect('color', { saturation: -1 }),
      // Only the left half of the frame: a rectangle 100% wide centred at x = -50%.
      effect('mask', { shape: 0, x: -50, y: 0, width: 100, height: 200, rotation: 0, feather: 0, invert: 0 })
    )
    insertClipAuto(project, adjustment)
    const output = exportProject(project, 'adjustment')
    // testsrc2 is colourful everywhere: left half grey, right half still in colour, and colour after the layer.
    expect(spread(pixel(output, 30, 300, 500))).toBeLessThan(12)
    expect(spread(pixel(output, 30, 900, 500))).toBeGreaterThan(12)
    expect(spread(pixel(output, 90, 300, 500))).toBeGreaterThan(12)
  })

  it('draws drop shadows and masks on layers', () => {
    const { project } = baseProject()
    const square = createShapeClip(0, FPS, 'rect')
    square.size = [200, 200]
    square.fill = '#ffffff'
    square.effects.push(
      effect('dropShadow', { distance: 60, angle: 90, blur: 0, opacity: 1 }),
      effect('mask', { shape: 1, x: 0, y: 0, width: 100, height: 100, rotation: 0, feather: 0, invert: 0 })
    )
    insertClipAuto(project, square)
    const output = exportProject(project, 'shadow')
    // White square in the middle; the shadow falls 60 px straight down, below its bottom edge (y = 460).
    expect(Math.min(...pixel(output, 10, 640, 360))).toBeGreaterThan(235)
    expect(Math.max(...pixel(output, 10, 640, 490))).toBeLessThan(20)
    // The mask is an ellipse the size of the frame, so the far corner of the frame shows the video.
    expect(spread(pixel(output, 10, 20, 700))).toBeGreaterThan(12)
  })

  it('grades through a .cube LUT', () => {
    const size = 9
    const rows: string[] = []
    for (let b = 0; b < size; b++)
      for (let g = 0; g < size; g++)
        for (let r = 0; r < size; r++)
          rows.push([r, g, b].map((v) => (1 - v / (size - 1)).toFixed(6)).join(' '))
    const lutPath = join(workDir, 'invert.cube')
    writeFileSync(lutPath, `LUT_3D_SIZE ${size}\n${rows.join('\n')}\n`)
    const { project, clip } = baseProject()
    clip.duration = 10
    clip.effects.push({ ...effect('lut', { intensity: 1 }), resource: lutPath })
    const output = exportProject(project, 'lut')
    for (const [x, y] of [
      [100, 100],
      [700, 400],
      [1100, 650]
    ] as const) {
      const source = pixel(fixture, 5, x, y)
      const graded = pixel(output, 5, x, y)
      source.forEach((v, i) => expect(Math.abs(graded[i]! - (255 - v))).toBeLessThan(12))
    }
  })

  it('fills the sides with a blurred copy', () => {
    const project = createProject('fill', { width: 1280, height: 720, fps: FPS })
    const still: MediaAsset = {
      id: newId(),
      kind: 'image',
      name: 'still',
      path: join(root, 'tests/fixtures/still.png'),
      size: 0,
      duration: 0,
      width: 400,
      height: 400,
      hasAudio: false
    }
    addMedia(project, still)
    const clip = clipFromMedia(still, 0, FPS)
    clip.duration = 5
    if (clip.type === 'image') clip.effects.push(effect('blurFill', { radius: 20, brightness: 0.5 }))
    insertClipAuto(project, clip)
    const output = exportProject(project, 'blur-fill')
    // The square covers the middle; the sides, black without the fill, show the dimmed green copy.
    const [r, g, b] = pixel(output, 2, 60, 360)
    expect(g).toBeGreaterThan(90)
    expect(g).toBeLessThan(160)
    expect(Math.max(r, b)).toBeLessThan(40)
    expect(pixel(output, 2, 640, 360)[1]).toBeGreaterThan(230)
  })

  it('renders every effect without shader errors', () => {
    const { project, clip } = baseProject()
    clip.duration = 10
    clip.effects = EFFECTS.map((spec) =>
      effect(spec.type, Object.fromEntries(Object.entries(spec.params).map(([k, p]) => [k, p.default])))
    )
    const { video } = probe(exportProject(project, 'all-effects'))
    expect(Number(video?.['nb_read_frames'])).toBe(10)
  })
})

describe('audio mix', () => {
  it('pans, applies track volume and filters like the preview', () => {
    const plain = exportProject(baseProject().project, 'mix-plain', 'wav')
    const reference = channelVolume(plain, 0)
    expect(Math.abs(channelVolume(plain, 1) - reference)).toBeLessThan(0.5)

    const panned = baseProject()
    panned.clip.pan = -1
    const left = exportProject(panned.project, 'mix-pan', 'wav')
    expect(channelVolume(left, 0)).toBeGreaterThan(reference - 1)
    expect(channelVolume(left, 1)).toBeLessThan(reference - 40)

    const quieter = baseProject()
    quieter.project.tracks[0]!.volume = 0.5
    expect(channelVolume(exportProject(quieter.project, 'mix-track', 'wav'), 0)).toBeCloseTo(reference - 6, 0)

    // A 2 kHz high-pass all but removes the 440 Hz test tone.
    const filtered = baseProject()
    filtered.clip.audioEffects = [
      { id: newId(), type: 'highpass', enabled: true, params: { frequency: { value: 2000 } } }
    ]
    expect(channelVolume(exportProject(filtered.project, 'mix-filter', 'wav'), 0)).toBeLessThan(
      reference - 20
    )
  })
})

/** Mean volume in dB of a stretch of a file's audio. */
function volumeAt(path: string, start: number, duration: number): number {
  const { stderr } = spawnSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-ss',
      String(start),
      '-t',
      String(duration),
      '-i',
      path,
      '-af',
      'volumedetect',
      '-f',
      'null',
      '-'
    ],
    { encoding: 'utf8' }
  )
  const value = stderr.match(/mean_volume:\s*(-?[\d.]+|-inf)/)?.[1]
  return value === undefined || value === '-inf' ? -Infinity : Number(value)
}

describe('audio crossfade', () => {
  it('lets the outgoing clip ring on and fade across the cut', () => {
    const { project, clip } = baseProject()
    clip.sourceIn = 1
    clip.duration = 60
    const silentRight = clipFromMedia(project.media[0]!, 60, FPS) as VideoClip
    silentRight.duration = 60
    silentRight.volume.value = 0
    insertClip(project, project.tracks[0]!.id, silentRight)
    const hard = exportProject(project, 'crossfade-off', 'wav')
    expect(setTransition(project, clip.id, 'crossfade', 30)).not.toBeNull()
    const soft = exportProject(project, 'crossfade-on', 'wav')
    const full = volumeAt(hard, 0.5, 0.2)
    // Without the transition the cut at 2 s is silent right after; with it, the tone rings on, fading.
    expect(volumeAt(hard, 2.1, 0.1)).toBeLessThan(full - 40)
    expect(volumeAt(soft, 2.1, 0.1)).toBeGreaterThan(full - 12)
    expect(volumeAt(soft, 2.1, 0.1)).toBeLessThan(full - 1)
    // 30 frames = 1 s, so the fade ends 0.5 s after the cut.
    expect(volumeAt(soft, 2.55, 0.1)).toBeLessThan(full - 40)
    expect(Math.abs(volumeAt(soft, 1.0, 0.2) - full)).toBeLessThan(0.5)
  })
})

describe('formats', () => {
  /** One second of the test pattern with its tone. */
  function short(): Project {
    const { project, clip } = baseProject()
    clip.duration = FPS
    return project
  }

  it.each([
    ['hevc', 'mp4', 'mp4-hevc', 'hevc', 'aac'],
    ['vp9', 'webm', 'webm-vp9', 'vp9', 'opus'],
    ['prores', 'mov', 'mov-prores', 'prores', 'pcm_s16le']
  ])('encodes %s video', (name, extension, format, videoCodec, audioCodec) => {
    const output = exportProject(short(), `format-${name}`, extension, format)
    const { video, audio } = probe(output)
    expect(video?.['codec_name']).toBe(videoCodec)
    expect(Number(video?.['nb_read_frames'])).toBe(FPS)
    expect(audio?.['codec_name']).toBe(audioCodec)
    expect(psnr(output, fixture)).toBeGreaterThan(30)
  })

  it('encodes an animated GIF without sound', () => {
    const { video, audio } = probe(exportProject(short(), 'format-gif', 'gif'))
    expect(video?.['codec_name']).toBe('gif')
    expect(Number(video?.['nb_read_frames'])).toBe(FPS)
    expect(audio).toBeUndefined()
  })

  it.each([
    ['mp3', 'mp3'],
    ['wav', 'pcm_s16le'],
    ['flac', 'flac']
  ])('exports only the sound as %s', (extension, codec) => {
    const { video, audio } = probe(exportProject(short(), `format-audio-${extension}`, extension))
    expect(video).toBeUndefined()
    expect(audio?.['codec_name']).toBe(codec)
    expect(Math.abs(Number(audio?.['duration']) - 1)).toBeLessThan(0.1)
  })

  it('saves a single frame as PNG', () => {
    const { project } = baseProject()
    const square = createShapeClip(0, FPS, 'rect')
    square.size = [200, 200]
    square.fill = '#ff0000'
    insertClipAuto(project, square)
    const output = exportProject(project, 'format-png', 'png')
    const { video } = probe(output)
    expect(video?.['codec_name']).toBe('png')
    expect([video?.['width'], video?.['height']]).toEqual([1280, 720])
    const [r, g, b] = pixel(output, 0, 640, 360)
    expect(r).toBeGreaterThan(240)
    expect(Math.max(g, b)).toBeLessThan(15)
  })
})
