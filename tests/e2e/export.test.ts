import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  addMedia,
  clipFromMedia,
  createProject,
  createShapeClip,
  insertClip,
  insertClipAuto,
  newId,
  serializeProject,
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

function exportProject(project: Project, name: string): string {
  const projectPath = join(workDir, `${name}.edion`)
  const output = join(workDir, `${name}.mp4`)
  writeFileSync(projectPath, serializeProject(project))
  const run = spawnSync(electron, [root], {
    env: { ...process.env, EDION_HEADLESS_EXPORT: `${projectPath}::${output}`, EDION_DEBUG_EXPORT: '1' },
    timeout: 150_000,
    encoding: 'utf8'
  })
  if (run.status !== 0) throw new Error(`export failed (${run.status})\n${run.stdout}\n${run.stderr}`)
  // EDION_E2E_KEEP=<dir> keeps the rendered files for inspection.
  if (process.env['EDION_E2E_KEEP']) copyFileSync(output, join(process.env['EDION_E2E_KEEP'], `${name}.mp4`))
  return output
}

function probe(path: string): { video: Record<string, string>; audio?: Record<string, string> } {
  const { streams } = JSON.parse(
    execFileSync(
      'ffprobe',
      ['-v', 'error', '-print_format', 'json', '-show_streams', '-count_frames', path],
      { encoding: 'utf8' }
    )
  ) as { streams: Array<Record<string, string>> }
  return {
    video: streams.find((s) => s['codec_type'] === 'video')!,
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
    ['-hide_banner', '-i', a, '-i', b, '-lavfi', '[0:v][1:v]psnr=shortest=1', '-f', 'null', '-'],
    { encoding: 'utf8' }
  )
  return Number(stderr.match(/average:([\d.]+)/)?.[1] ?? 0)
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
    expect(video['codec_name']).toBe('h264')
    expect([video['width'], video['height']]).toEqual([1280, 720])
    expect(video['r_frame_rate']).toBe(`${FPS}/1`)
    expect(Number(video['nb_read_frames'])).toBe(SECONDS * FPS)
    expect(video['color_space']).toBe('bt709')
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
    expect(Number(video['nb_read_frames'])).toBe(FPS)
    expect(audio?.['codec_name']).toBe('aac')
    expect(psnr(output, fixture)).toBeGreaterThan(30)
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
    expect(Number(probe(output).video['nb_read_frames'])).toBe(SECONDS * FPS)

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
