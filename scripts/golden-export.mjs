// Golden export test: fixture → headless Edion export → ffprobe + PSNR assertions.
// Usage: pnpm test:export   (requires a prior `electron-vite build`)
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const electron = require('electron')
const root = resolve(import.meta.dirname, '..')
const fixtureDir = join(root, 'tests/fixtures')
const fixture = join(fixtureDir, 'testsrc-720p30.mp4')
const DURATION = 4
const FPS = 30

if (!existsSync(fixture)) {
  mkdirSync(fixtureDir, { recursive: true })
  execFileSync('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `testsrc2=size=1280x720:rate=${FPS}:duration=${DURATION}`,
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=440:duration=${DURATION}`,
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

const workDir = mkdtempSync(join(tmpdir(), 'edion-golden-'))
const output = join(workDir, 'out.mp4')
const failures = []
const check = (ok, message) => {
  console.log(`${ok ? '✓' : '✗'} ${message}`)
  if (!ok) failures.push(message)
}

try {
  const run = spawnSync(electron, [root], {
    env: { ...process.env, EDION_HEADLESS_EXPORT: `${fixture}::${output}` },
    timeout: 120_000,
    encoding: 'utf8'
  })
  check(run.status === 0, `headless export exits cleanly (status ${run.status})`)
  if (run.status !== 0) console.error(run.stderr)

  const probe = JSON.parse(
    execFileSync(
      'ffprobe',
      ['-v', 'error', '-print_format', 'json', '-show_streams', '-count_frames', output],
      {
        encoding: 'utf8'
      }
    )
  )
  const video = probe.streams.find((s) => s.codec_type === 'video')
  const audio = probe.streams.find((s) => s.codec_type === 'audio')
  check(video?.codec_name === 'h264', 'video is H.264')
  check(video?.width === 1280 && video?.height === 720, 'resolution is 1280x720')
  check(video?.r_frame_rate === `${FPS}/1`, `frame rate is ${FPS} fps`)
  check(Math.abs(Number(video?.nb_read_frames) - DURATION * FPS) <= 1, `frame count is ${DURATION * FPS} ±1`)
  check(video?.color_space === 'bt709', 'colour space tagged bt709')
  check(Boolean(audio), 'audio stream present')

  const psnr = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-i', output, '-i', fixture, '-lavfi', '[0:v][1:v]psnr', '-f', 'null', '-'],
    { encoding: 'utf8' }
  ).stderr.match(/average:([\d.]+)/)
  const average = Number(psnr?.[1] ?? 0)
  check(average > 35, `export matches source (PSNR ${average.toFixed(1)} dB > 35)`)
} finally {
  rmSync(workDir, { recursive: true, force: true })
}

process.exit(failures.length ? 1 : 0)
