import { describe, expect, it } from 'vitest'
import {
  applyAnimationPreset,
  applyTextLook,
  captureTextLook,
  createCaptionClip,
  createProject,
  createStyledTextClip,
  createTextClip,
  evaluate,
  evaluateScene,
  insertClipAuto
} from '@core/index'

function styled() {
  const clip = createTextClip(0, 30, 'Signature')
  clip.duration = 150
  clip.style.fontFamily = 'Brush Script'
  clip.style.fontSize = 72
  clip.style.color = '#ffcc00'
  clip.style.strokeWidth = 3
  clip.boxWidth = 900
  clip.reveal = { mode: 'words', seconds: 1 }
  clip.transform.position.value = [0, 380]
  clip.effects.push({ id: 'x', type: 'glow', enabled: true, params: { radius: { value: 20 } } })
  applyAnimationPreset(clip, 'in', 'slideUp', 15, { width: 1920, height: 1080 })
  applyAnimationPreset(clip, 'out', 'fade', 15, { width: 1920, height: 1080 })
  return clip
}

describe('text looks', () => {
  it('captures a look and gives it to another clip, keeping its words and timing', () => {
    const look = captureTextLook(styled())
    const other = createTextClip(300, 30, 'Another line')
    other.duration = 60
    applyTextLook(other, look)
    expect(other.text).toBe('Another line')
    expect([other.start, other.duration]).toEqual([300, 60])
    expect(other.style.fontFamily).toBe('Brush Script')
    expect(other.style.color).toBe('#ffcc00')
    expect(other.boxWidth).toBe(900)
    expect(other.reveal).toEqual({ mode: 'words', seconds: 1 })
    expect(other.effects).toHaveLength(1)
    expect(other.effects[0]!.id).not.toBe('x')
  })

  it('fits entrance and exit animations to the new length', () => {
    const source = styled()
    // Keyframes in the first half stay put; those in the second half keep their distance from the end.
    const expected = source.transform.opacity.keyframes!.map((k) =>
      k.frame < source.duration / 2 ? k.frame : 40 - (source.duration - k.frame)
    )
    const look = captureTextLook(source)
    const short = createStyledTextClip(0, 30, 'Short', look)
    short.duration = 40
    applyTextLook(short, look)
    // The fade-out keeps its distance from the end; the slide-in keeps its distance from the start.
    expect(short.transform.opacity.keyframes!.map((k) => k.frame)).toEqual(expected)
    expect(evaluate(short.transform.opacity, 39)).toBeLessThan(0.2)
    expect(evaluate(short.transform.opacity, 20)).toBeCloseTo(1)
    expect(short.transform.position.keyframes!.map((k) => k.frame)).toEqual(
      source.transform.position.keyframes!.map((k) => k.frame)
    )
  })

  it('survives saving as JSON', () => {
    const look = JSON.parse(JSON.stringify(captureTextLook(styled())))
    expect(createStyledTextClip(0, 30, 'x', look).style.fontSize).toBe(72)
  })
})

describe('caption animation', () => {
  it('types captions on and fades them', () => {
    const project = createProject()
    const caption = createCaptionClip(0, 60, 'Hello there world')
    insertClipAuto(project, caption)
    project.captionAnimation = { reveal: { mode: 'letters', seconds: 1 }, fade: 10 }
    const at = (frame: number) => evaluateScene(project, frame).captions[0]!
    expect(at(0).reveal).toBe(0)
    expect(at(15).reveal).toBe(7)
    expect(at(40).reveal).toBe(15)
    expect(at(0).opacity).toBeCloseTo(0.1)
    expect(at(30).opacity).toBe(1)
    expect(at(59).opacity).toBeCloseTo(0.1)
    project.captionAnimation = undefined
    expect(at(0)).toEqual({ clip: project.tracks[0]!.clips[0], opacity: 1 })
  })
})
