import { audioEffectSpec, evaluate } from '@core/index'
import type { AudioSource, Effect, Id, Project } from '@core/index'

const dbToGain = (db: number): number => 10 ** (db / 20)

/**
 * The audio graph between decoded buffers and the output: clip effects → clip pan → track bus (volume,
 * pan) → destination. Each clip gets one chain, built on first use, which every buffer of that clip
 * feeds into, so filters keep their state across buffers and never click. Live playback and the export
 * mix both build their graphs with this class, so they sound the same.
 */
export class Mixer {
  private readonly buses = new Map<Id, AudioNode>()
  private readonly inputs = new Map<Id, AudioNode>()
  private readonly nodes: AudioNode[] = []

  constructor(
    private readonly context: BaseAudioContext,
    private readonly project: Project,
    private readonly destination: AudioNode
  ) {}

  /** The node a source's buffers connect to. */
  input({ clip, trackId }: AudioSource): AudioNode {
    let input = this.inputs.get(clip.id)
    if (input) return input
    input = this.node(this.context.createGain())
    let last: AudioNode = input
    for (const effect of clip.audioEffects ?? []) {
      if (!effect.enabled) continue
      const [first, end] = this.effect(effect)
      last.connect(first)
      last = end
    }
    if (clip.pan) {
      const panner = this.node(this.context.createStereoPanner())
      panner.pan.value = clip.pan
      last.connect(panner)
      last = panner
    }
    last.connect(this.bus(trackId))
    this.inputs.set(clip.id, input)
    return input
  }

  private bus(trackId: Id): AudioNode {
    let bus = this.buses.get(trackId)
    if (bus) return bus
    const track = this.project.tracks.find((t) => t.id === trackId)
    const gain = this.node(this.context.createGain())
    gain.gain.value = track?.volume ?? 1
    bus = gain
    if (track?.pan) {
      const panner = this.node(this.context.createStereoPanner())
      panner.pan.value = track.pan
      gain.connect(panner)
      panner.connect(this.destination)
    } else gain.connect(this.destination)
    this.buses.set(trackId, bus)
    return bus
  }

  /** First and last node of one effect. */
  private effect(effect: Effect): [AudioNode, AudioNode] {
    const spec = audioEffectSpec(effect.type)
    const param = (key: string): number => {
      const anim = effect.params[key]
      return anim ? evaluate(anim, 0) : (spec?.params[key]?.default ?? 0)
    }
    const biquad = (type: BiquadFilterType, frequency: number, gain = 0, q = 0.707): BiquadFilterNode => {
      const node = this.node(this.context.createBiquadFilter())
      node.type = type
      node.frequency.value = frequency
      node.gain.value = gain
      node.Q.value = q
      return node
    }
    switch (effect.type) {
      case 'eq': {
        const low = biquad('lowshelf', 120, param('low'))
        const mid = biquad('peaking', 1000, param('mid'), 0.9)
        const high = biquad('highshelf', 8000, param('high'))
        low.connect(mid).connect(high)
        return [low, high]
      }
      case 'highpass': {
        const node = biquad('highpass', param('frequency'))
        return [node, node]
      }
      case 'lowpass': {
        const node = biquad('lowpass', param('frequency'))
        return [node, node]
      }
      case 'compressor': {
        const compressor = this.node(this.context.createDynamicsCompressor())
        compressor.threshold.value = param('threshold')
        compressor.ratio.value = param('ratio')
        compressor.knee.value = 6
        compressor.attack.value = 0.005
        compressor.release.value = 0.2
        const makeup = this.node(this.context.createGain())
        makeup.gain.value = dbToGain(param('makeup'))
        compressor.connect(makeup)
        return [compressor, makeup]
      }
      default: {
        // Unknown effect (from a newer version): pass the sound through.
        const node = this.node(this.context.createGain())
        return [node, node]
      }
    }
  }

  private node<T extends AudioNode>(node: T): T {
    this.nodes.push(node)
    return node
  }

  dispose(): void {
    for (const node of this.nodes) node.disconnect()
    this.nodes.length = 0
    this.buses.clear()
    this.inputs.clear()
  }
}
