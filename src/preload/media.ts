import { open, type FileHandle } from 'node:fs/promises'
import { webUtils } from 'electron'
import type { EdionApi } from '@shared/ipc'

const handles = new Map<string, Promise<FileHandle>>()

function handleFor(path: string): Promise<FileHandle> {
  let handle = handles.get(path)
  if (!handle) {
    handle = open(path, 'r')
    handles.set(path, handle)
    handle.catch(() => handles.delete(path))
  }
  return handle
}

/** Direct ranged disk reads for the decoder, without an IPC round trip through main. */
export const mediaApi: EdionApi['media'] = {
  async open(path) {
    return (await (await handleFor(path)).stat()).size
  },
  async read(path, start, end) {
    const registered = handles.get(path)
    if (!registered) throw new Error(`Media not opened: ${path}`)
    const buffer = new Uint8Array(end - start)
    const { bytesRead } = await (await registered).read(buffer, 0, buffer.length, start)
    return bytesRead === buffer.length ? buffer : buffer.subarray(0, bytesRead)
  },
  pathForFile: (file) => webUtils.getPathForFile(file)
}
