import { describe, expect, it } from 'vitest'
import { chapterList, moveMarker, nextEditPoint, nextMarker } from '@core/index'
import { projectWithClips } from './helpers'

const marker = (id: string, frame: number, label = '') => ({ id, frame, label, color: '#fff' })

describe('navigation', () => {
  it('finds the previous and next edit points', () => {
    const { project } = projectWithClips([0, 30], [50, 30])
    expect(nextEditPoint(project, 0, 1)).toBe(30)
    expect(nextEditPoint(project, 30, 1)).toBe(50)
    expect(nextEditPoint(project, 60, 1)).toBe(80)
    expect(nextEditPoint(project, 80, 1)).toBeNull()
    expect(nextEditPoint(project, 60, -1)).toBe(50)
    expect(nextEditPoint(project, 0, -1)).toBeNull()
    project.tracks[0]!.hidden = true
    expect(nextEditPoint(project, 0, 1)).toBeNull()
  })

  it('steps through markers and moves them', () => {
    const { project } = projectWithClips([0, 30])
    project.markers = [marker('a', 10), marker('b', 40)]
    expect(nextMarker(project, 10, 1)).toBe(40)
    expect(nextMarker(project, 10, -1)).toBeNull()
    expect(nextMarker(project, 100, -1)).toBe(40)
    moveMarker(project, 'b', 5)
    expect(project.markers.map((m) => [m.id, m.frame])).toEqual([
      ['b', 5],
      ['a', 10]
    ])
    moveMarker(project, 'b', 10)
    expect(project.markers.map((m) => m.id)).toEqual(['b'])
  })

  it('writes YouTube chapters', () => {
    const { project } = projectWithClips([0, 30])
    expect(chapterList(project)).toBe('')
    project.markers = [marker('b', 30 * 75, 'Setup'), marker('a', 30 * 12)]
    expect(chapterList(project)).toBe('0:00 Intro\n0:12 Chapter 1\n1:15 Setup')
    project.markers.push(marker('c', 0, 'Start'))
    expect(chapterList(project).split('\n')[0]).toBe('0:00 Start')
  })
})
