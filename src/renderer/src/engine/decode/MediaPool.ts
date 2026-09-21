import type { Input, InputAudioTrack, InputVideoTrack } from 'mediabunny'
import type { EdionApi } from '@shared/ipc'
import { openMediaInput } from './mediaInput'

export interface OpenMedia {
  input: Input
  video: InputVideoTrack | null
  audio: InputAudioTrack | null
  /** False when Chromium has no decoder for the codec; such media needs a proxy. */
  videoDecodable: boolean
  audioDecodable: boolean
}

/** Opens each media file once and shares the demuxer between all clips that use it. */
export class MediaPool {
  private readonly entries = new Map<string, Promise<OpenMedia | null>>()

  constructor(private readonly media: EdionApi['media']) {}

  open(path: string): Promise<OpenMedia | null> {
    let entry = this.entries.get(path)
    if (!entry) {
      entry = this.load(path).catch((error) => {
        console.warn(`[media] cannot open ${path}`, error)
        return null
      })
      this.entries.set(path, entry)
    }
    return entry
  }

  private async load(path: string): Promise<OpenMedia> {
    const input = await openMediaInput(this.media, path)
    const video = await input.getPrimaryVideoTrack()
    const audio = await input.getPrimaryAudioTrack()
    return {
      input,
      video,
      audio,
      videoDecodable: video ? await video.canDecode() : false,
      audioDecodable: audio ? await audio.canDecode() : false
    }
  }

  forget(path: string): void {
    void this.entries.get(path)?.then((m) => m?.input.dispose())
    this.entries.delete(path)
  }

  dispose(): void {
    for (const path of [...this.entries.keys()]) this.forget(path)
  }
}
