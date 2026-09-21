import type { Input, InputAudioTrack, InputVideoTrack } from 'mediabunny'
import type { EdionApi } from '@shared/ipc'
import { openMediaInput } from './mediaInput'

export interface OpenMedia {
  input: Input
  video: InputVideoTrack | null
  audio: InputAudioTrack | null
  /** False when Chromium has no decoder for the codec. */
  videoDecodable: boolean
  audioDecodable: boolean
  /** The file actually being read (the original or a proxy). */
  sourcePath: string
}

export interface ProxyProvider {
  /** A proxy that already exists and should be preferred (performance proxies), or null. */
  ready(path: string): string | null
  /** Generates (or finds) a decodable stand-in for media the app cannot read itself. */
  require(path: string): Promise<string | null>
}

/** Opens each media file once and shares the demuxer between all clips that use it. */
export class MediaPool {
  private readonly entries = new Map<string, Promise<OpenMedia | null>>()

  constructor(
    private readonly media: EdionApi['media'],
    private readonly proxies?: ProxyProvider
  ) {}

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

  private async load(path: string): Promise<OpenMedia | null> {
    const ready = this.proxies?.ready(path)
    if (ready) return this.openFile(ready)

    const original = await this.openFile(path).catch(() => null)
    const usable =
      original &&
      (original.video || original.audio) &&
      (!original.video || original.videoDecodable) &&
      (!original.audio || original.audioDecodable)
    if (usable || !this.proxies) return original

    // Unknown container or codec (ProRes, AVI, AC-3…): fall back to a transcoded stand-in.
    const proxy = await this.proxies.require(path)
    if (!proxy) return original
    original?.input.dispose()
    return this.openFile(proxy)
  }

  private async openFile(path: string): Promise<OpenMedia> {
    const input = await openMediaInput(this.media, path)
    const video = await input.getPrimaryVideoTrack()
    const audio = await input.getPrimaryAudioTrack()
    return {
      input,
      video,
      audio,
      videoDecodable: video ? await video.canDecode() : false,
      audioDecodable: audio ? await audio.canDecode() : false,
      sourcePath: path
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
