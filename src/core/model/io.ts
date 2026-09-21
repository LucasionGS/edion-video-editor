import { createProject } from './factory'
import { PROJECT_VERSION, projectSchema } from './schema'
import type { Project } from './types'

type Migration = (raw: Record<string, unknown>) => Record<string, unknown>

/** `MIGRATIONS[n]` upgrades a version-n file to version n+1. */
const MIGRATIONS: Record<number, Migration> = {}

export class ProjectFormatError extends Error {}

export function parseProject(json: string): Project {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new ProjectFormatError('The file is not valid JSON.')
  }
  if (typeof raw !== 'object' || raw === null || (raw as { app?: unknown }).app !== 'edion') {
    throw new ProjectFormatError('This is not an Edion project file.')
  }
  let data = raw as Record<string, unknown>
  let version = typeof data['version'] === 'number' ? data['version'] : 0
  if (version > PROJECT_VERSION) {
    throw new ProjectFormatError('This project was saved by a newer version of Edion.')
  }
  while (version < PROJECT_VERSION) {
    const migrate = MIGRATIONS[version]
    if (!migrate) throw new ProjectFormatError(`No migration from project version ${version}.`)
    data = migrate(data)
    version++
    data['version'] = version
  }
  const result = projectSchema.safeParse(data)
  if (!result.success) {
    const issue = result.error.issues[0]
    throw new ProjectFormatError(`The project file is damaged (${issue?.path.join('.')}: ${issue?.message}).`)
  }
  return result.data
}

export const serializeProject = (project: Project): string => JSON.stringify(project, null, 2)

export { createProject }
