import { exportFormat } from './formats'
import type { EncoderStart } from './ipc'

/**
 * FFmpeg command line for one export. Video arrives as raw RGBA on stdin, audio as a raw f32le stereo
 * file; this only encodes and muxes. Pure, so every format's arguments are unit-tested.
 */
export function ffmpegArgs(start: EncoderStart): string[] {
  const format = exportFormat(start.format)
  const { encoder, audio, quality } = start
  const video = format.video && encoder ? format.video : null
  // Without video on stdin FFmpeg would read it for interactive commands.
  const args = ['-hide_banner', '-loglevel', 'error', '-y', ...(video ? [] : ['-nostdin'])]

  if (video) {
    args.push(...encoder!.globalArgs)
    args.push('-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${start.width}x${start.height}`)
    args.push('-r', start.fps, '-i', 'pipe:0')
  }
  const withAudio = audio && format.audio ? audio : null
  if (withAudio)
    args.push('-f', 'f32le', '-ar', String(withAudio.sampleRate), '-ac', '2', '-i', withAudio.path)
  if (video) args.push('-map', '0:v:0')
  if (withAudio) args.push('-map', `${video ? 1 : 0}:a:0`)

  if (video === 'gif') {
    // One palette per clip, reused across frames; lower qualities trade frame rate and colours for size.
    const fps = rate(start.fps)
    const target =
      quality === 'high' ? Math.min(fps, 30) : quality === 'medium' ? Math.min(fps, 20) : Math.min(fps, 12)
    const colors = quality === 'low' ? 128 : 256
    args.push(
      '-vf',
      `fps=${Number(target.toFixed(3))},split[a][b];[a]palettegen=max_colors=${colors}:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
      '-loop',
      '0',
      '-c:v',
      'gif'
    )
  } else if (video === 'png') {
    args.push('-frames:v', '1', '-vf', 'format=rgb24', '-c:v', 'png')
  } else if (video) {
    args.push(
      // The compositor works in sRGB/BT.709; convert and tag explicitly so players don't have to guess.
      '-vf',
      `scale=out_color_matrix=bt709:out_range=tv${encoder!.filterSuffix}`,
      '-c:v',
      encoder!.name,
      ...encoder!.codecArgs[quality]
    )
    if (encoder!.pixelFormat) args.push('-pix_fmt', encoder!.pixelFormat)
    // Apple players only accept HEVC in MP4/MOV with the hvc1 tag.
    if (video === 'hevc') args.push('-tag:v', 'hvc1')
    args.push(
      '-colorspace',
      'bt709',
      '-color_primaries',
      'bt709',
      '-color_trc',
      'bt709',
      '-color_range',
      'tv'
    )
  }

  if (withAudio) {
    const bitrate = ['-b:a', `${withAudio.bitrateKbps}k`]
    switch (format.audio) {
      case 'aac':
        args.push('-c:a', 'aac', ...bitrate)
        break
      case 'opus':
        args.push('-c:a', 'libopus', ...bitrate)
        break
      case 'mp3':
        args.push('-c:a', 'libmp3lame', ...bitrate)
        break
      case 'pcm':
        args.push('-c:a', 'pcm_s16le')
        break
      case 'flac':
        args.push('-c:a', 'flac')
        break
    }
  }
  if (format.extension === 'mp4' || format.extension === 'mov') args.push('-movflags', '+faststart')
  if (video && withAudio) args.push('-shortest')
  args.push(start.outputPath)
  return args
}

/** Frames per second from FFmpeg's rational notation (`30000/1001`). */
function rate(fps: string): number {
  const [num, den = '1'] = fps.split('/')
  return Number(num) / Number(den)
}
