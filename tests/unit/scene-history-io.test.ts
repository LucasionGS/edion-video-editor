import { describe, expect, it } from 'vitest'
import {
  collectAudioSources,
  createProject,
  createTextClip,
  evaluateScene,
  gainAt,
  History,
  insertClipAuto,
  parseProject,
  ProjectFormatError,
  serializeProject,
  setTransition,
  splitClip,
  upsertKeyframe,
  createAdjustmentClip,
  findClip
} from '@core/index'
import type { Layer, Project, TransitionNode } from '@core/index'
import { projectWithClips } from './helpers'

describe('scene', () => {
  it('paints lower tracks first', () => {
    const { project, clips } = projectWithClips([0, 100])
    const text = createTextClip(0, 30)
    insertClipAuto(project, text)
    const scene = evaluateScene(project, 10)
    expect(scene.nodes.map((n) => (n as Layer).clip.id)).toEqual([clips[0]!.id, text.id])
  })
  it('resolves source time with speed and in point', () => {
    const { project, clips } = projectWithClips([30, 100])
    clips[0]!.sourceIn = 2
    clips[0]!.speed = 2
    const layer = evaluateScene(project, 60).nodes[0] as Layer
    expect(layer.sourceTime).toBeCloseTo(4)
  })
  it('evaluates keyframes and skips hidden tracks', () => {
    const { project, clips } = projectWithClips([0, 100])
    upsertKeyframe(clips[0]!.transform.opacity, 0, 0, 'linear')
    upsertKeyframe(clips[0]!.transform.opacity, 100, 1, 'linear')
    expect((evaluateScene(project, 50).nodes[0] as Layer).transform.opacity).toBeCloseTo(0.5)
    project.tracks[0]!.hidden = true
    expect(evaluateScene(project, 50).nodes).toHaveLength(0)
  })
  it('blends both clips inside a transition', () => {
    const { project, clips } = projectWithClips([0, 100], [100, 100])
    setTransition(project, clips[0]!.id, 'crossfade', 20)
    expect(evaluateScene(project, 89).nodes[0]!.kind).toBe('layer')
    const node = evaluateScene(project, 100).nodes[0] as TransitionNode
    expect(node.kind).toBe('transition')
    expect(node.progress).toBeCloseTo(0.525)
    expect(node.to.localFrame).toBe(0)
    expect(evaluateScene(project, 110).nodes[0]!.kind).toBe('layer')
  })
  it('is empty past the end', () => {
    const { project } = projectWithClips([0, 100])
    expect(evaluateScene(project, 100).nodes).toHaveLength(0)
  })
})

describe('audio', () => {
  it('honours mute and solo', () => {
    const { project } = projectWithClips([0, 100])
    expect(collectAudioSources(project)).toHaveLength(1)
    project.tracks[1]!.solo = true
    expect(collectAudioSources(project)).toHaveLength(0)
    project.tracks[1]!.solo = false
    project.tracks[0]!.muted = true
    expect(collectAudioSources(project)).toHaveLength(0)
  })
  it('shapes gain with fades', () => {
    const { clips } = projectWithClips([0, 100])
    const clip = clips[0]!
    clip.fadeIn = 10
    clip.fadeOut = 20
    expect(gainAt(clip, 0)).toBe(0)
    expect(gainAt(clip, 5)).toBeCloseTo(0.5)
    expect(gainAt(clip, 50)).toBe(1)
    expect(gainAt(clip, 90)).toBeCloseTo(0.5)
  })
})

describe('history', () => {
  it('undoes and redoes', () => {
    const history = new History<Project>()
    const initial = projectWithClips([0, 100])
    let state = initial.project
    state = history.apply(state, 'Split', (d) => void splitClip(d, initial.clips[0]!.id, 50))
    expect(state.tracks[0]!.clips).toHaveLength(2)
    state = history.undo(state)
    expect(state.tracks[0]!.clips).toHaveLength(1)
    expect(state).toEqual(initial.project)
    state = history.redo(state)
    expect(state.tracks[0]!.clips).toHaveLength(2)
  })
  it('folds a transaction into one step and can roll back', () => {
    const history = new History<Project>()
    let state = createProject()
    history.begin('Rename')
    for (const name of ['a', 'ab', 'abc']) state = history.apply(state, 'Rename', (d) => void (d.name = name))
    history.commit()
    expect(state.name).toBe('abc')
    state = history.undo(state)
    expect(state.name).toBe('Untitled project')
    expect(history.canUndo).toBe(false)

    history.begin('Drag')
    state = history.apply(state, 'Drag', (d) => void (d.name = 'temp'))
    state = history.rollback(state)
    expect(state.name).toBe('Untitled project')
    expect(history.canUndo).toBe(false)
  })
  it('clears redo on a new edit and ignores no-ops', () => {
    const history = new History<Project>()
    let state = createProject()
    state = history.apply(state, 'A', (d) => void (d.name = 'A'))
    state = history.undo(state)
    state = history.apply(state, 'noop', () => {})
    expect(history.canRedo).toBe(true)
    state = history.apply(state, 'B', (d) => void (d.name = 'B'))
    expect(history.canRedo).toBe(false)
  })
})

describe('project io', () => {
  it('round-trips', () => {
    const { project, clips } = projectWithClips([0, 100], [100, 50])
    setTransition(project, clips[0]!.id, 'crossfade', 10)
    insertClipAuto(project, createTextClip(0, 30))
    expect(parseProject(serializeProject(project))).toEqual(project)
  })
  it('rejects foreign, newer and damaged files with clear errors', () => {
    expect(() => parseProject('nope')).toThrow(ProjectFormatError)
    expect(() => parseProject('{"app":"other"}')).toThrow(/not an Edion project/)
    expect(() => parseProject(JSON.stringify({ ...createProject(), version: 999 }))).toThrow(/newer version/)
    expect(() => parseProject(JSON.stringify({ ...createProject(), tracks: 'x' }))).toThrow(/damaged/)
  })
})

describe('adjustment layers', () => {
  it('evaluate into adjustment nodes above the layers they cover', () => {
    const { project } = projectWithClips([0, 60])
    const adjustment = createAdjustmentClip(10, 30)
    adjustment.duration = 20
    adjustment.effects.push({ id: 'fx', type: 'color', enabled: true, params: { saturation: { value: -1 } } })
    upsertKeyframe(adjustment.opacity, 0, 0)
    upsertKeyframe(adjustment.opacity, 10, 1)
    insertClipAuto(project, adjustment)
    expect(project.tracks[0]!.clips[0]!.id).toBe(adjustment.id)
    const scene = evaluateScene(project, 15)
    expect(scene.nodes.map((n) => n.kind)).toEqual(['layer', 'adjustment'])
    const node = scene.nodes[1]!
    expect(node.kind === 'adjustment' && node.opacity).toBeCloseTo(0.5)
    expect(node.kind === 'adjustment' && node.effects[0]!.params['saturation']).toBe(-1)
    expect(evaluateScene(project, 40).nodes.map((n) => n.kind)).toEqual(['layer'])
  })

  it('goes on a new top track when the top track is busy, and splits like other clips', () => {
    const { project } = projectWithClips([0, 60])
    const adjustment = createAdjustmentClip(0, 30)
    insertClipAuto(project, adjustment)
    const again = createAdjustmentClip(10, 30)
    insertClipAuto(project, again)
    expect(project.tracks[0]!.clips[0]!.id).toBe(again.id)
    const right = splitClip(project, adjustment.id, 50)!
    expect(findClip(project, right)!.clip.type).toBe('adjustment')
  })
})
