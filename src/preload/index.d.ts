import type { EdionApi, EdionExportApi } from '@shared/ipc'

declare global {
  interface Window {
    edion: EdionApi
    edionExport: EdionExportApi
  }
}
