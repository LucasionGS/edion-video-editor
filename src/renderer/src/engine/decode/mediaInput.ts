import { ALL_FORMATS, Input, StreamSource } from 'mediabunny'
import type { EdionApi } from '@shared/ipc'

/** Opens a media file for demuxing/decoding, reading straight from disk through the preload bridge. */
export async function openMediaInput(media: EdionApi['media'], path: string): Promise<Input> {
  const size = await media.open(path)
  return new Input({
    formats: ALL_FORMATS,
    source: new StreamSource({
      getSize: () => size,
      read: (start, end) => media.read(path, start, end),
      prefetchProfile: 'fileSystem',
      maxCacheSize: 64 * 1024 * 1024
    })
  })
}
