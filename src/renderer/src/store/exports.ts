import { create } from 'zustand'
import type { ExportJobState } from '@shared/ipc'
import { toast } from './feedback'

/** Mirror of the main-process export queue. */
export const useExports = create<{ jobs: ExportJobState[] }>(() => ({ jobs: [] }))

let wired = false

export function wireExports(): void {
  if (wired) return
  wired = true
  void window.edion.export.list().then((jobs) => useExports.setState({ jobs }))
  window.edion.export.onUpdate((jobs) => {
    const before = new Map(useExports.getState().jobs.map((j) => [j.id, j.state]))
    for (const job of jobs) {
      if (before.get(job.id) === job.state) continue
      if (job.state === 'done') toast(`Exported “${job.name}”`, 'success')
      if (job.state === 'error') toast(`Export failed: ${job.message ?? 'unknown error'}`, 'error')
    }
    useExports.setState({ jobs })
  })
}

export const activeJob = (jobs: ExportJobState[]): ExportJobState | undefined =>
  jobs.find((j) => j.state === 'running')
