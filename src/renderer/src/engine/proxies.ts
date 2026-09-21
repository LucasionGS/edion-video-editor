import { create } from 'zustand'
import type { MediaAsset } from '@core/index'
import type { ProxyProvider } from './decode/MediaPool'

type ProxyState = 'pending' | 'failed' | { path: string }

/** Preview-proxy bookkeeping for the editor window. */
export const useProxies = create<{ byPath: Record<string, ProxyState> }>(() => ({ byPath: {} }))

const listeners = new Set<(originalPath: string) => void>()
/** Fires when a proxy became available, so open decoders can switch over to it. */
export const onProxyReady = (cb: (originalPath: string) => void): (() => void) => {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

const HEAVY_CODECS = new Set(['hevc', 'h265', 'av1', 'prores', 'vp9', 'dnxhd', 'mpeg2video', 'mjpeg'])

/** Footage that plays poorly straight from the source: above ~1080p, or an expensive codec. */
export const benefitsFromProxy = (asset: MediaAsset): boolean =>
  asset.kind === 'video' &&
  (Math.min(asset.width ?? 0, asset.height ?? 0) > 1200 || HEAVY_CODECS.has(asset.videoCodec ?? ''))

export function requestProxy(path: string): Promise<string | null> {
  const current = useProxies.getState().byPath[path]
  if (typeof current === 'object') return Promise.resolve(current.path)
  const set = (state: ProxyState): void =>
    useProxies.setState((s) => ({ byPath: { ...s.byPath, [path]: state } }))
  set('pending')
  return window.edion.library.proxy(path, 'preview').then(
    (proxy) => {
      set(proxy ? { path: proxy } : 'failed')
      if (proxy) for (const cb of listeners) cb(path)
      return proxy
    },
    () => {
      set('failed')
      return null
    }
  )
}

export const editorProxies: ProxyProvider = {
  ready(path) {
    const state = useProxies.getState().byPath[path]
    return typeof state === 'object' ? state.path : null
  },
  require: requestProxy
}
