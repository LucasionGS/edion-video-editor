import { describe, expect, it } from 'vitest'
import { addTrack, audioOffset, clipFromMedia, findClip, insertClip, syncClip } from '@core/index'
import type { VideoClip } from '@core/index'
import { projectWithClips, videoAsset } from './helpers'

/** A deterministic, speech-like envelope: bursts of varying loudness and length. */
function envelope(length: number, seed = 7): Uint8Array {
  const data = new Uint8Array(length)
  let x = seed
  const random = (): number => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648
  for (let i = 0; i < length;) {
    const burst = 5 + Math.floor(random() * 40)
    const level = random() < 0.4 ? 0 : 60 + Math.floor(random() * 180)
    for (let k = 0; k < burst && i < length; k++, i++) data[i] = Math.max(0, level - k * 2)
  }
  return data
}

describe('sync by audio', () => {
  it('finds the offset between two recordings of the same sound', () => {
    const full = envelope(6000)
    // `other` starts recording 12.34 s later than `reference` and runs a bit shorter, with some noise.
    const other = full.slice(1234, 5000).map((v, i) => Math.min(255, v + ((i * 37) % 11)))
    const { seconds, confidence } = audioOffset(full, other, 100)
    expect(seconds).toBeCloseTo(12.34, 2)
    expect(confidence).toBeGreaterThan(0.5)
    // The other way round.
    expect(audioOffset(other, full, 100).seconds).toBeCloseTo(-12.34, 2)
  })

  it('reports low confidence for unrelated sound', () => {
    expect(audioOffset(envelope(3000, 1), envelope(3000, 99), 100).confidence).toBeLessThan(0.3)
  })

  it('moves a clip so the same moments line up', () => {
    const { project, clips } = projectWithClips([30, 90])
    const reference = clips[0]!
    reference.sourceIn = 2
    const recorder = videoAsset(20)
    const track = addTrack(project, 'video')
    const other = clipFromMedia(recorder, 0, 30) as VideoClip
    other.sourceIn = 8
    other.duration = 60
    insertClip(project, track.id, other)
    // The recorder started 5 s before the camera: its time t is the camera's t - 5.
    expect(syncClip(project, reference.id, other.id, -5)).toBe(true)
    // Recorder 7 s is camera 2 s: both must land on the same timeline frame.
    const moved = findClip(project, other.id)!.clip as VideoClip
    const cameraFrameFor2s = reference.start + (2 - reference.sourceIn) * 30
    const recorderFrameFor7s = moved.start + (7 - moved.sourceIn) * 30
    expect(moved.start).toBe(60)
    expect(recorderFrameFor7s).toBe(cameraFrameFor2s)
  })
})
