// apps/pwa/src/services/audioCapture.ts

export type AudioWindowCallback = (samples: Float32Array) => void

export class AudioCapture {
  private context: AudioContext | null = null
  private stream: MediaStream | null = null
  private node: AudioWorkletNode | null = null

  constructor(private onWindow: AudioWindowCallback) {}

  async start(): Promise<void> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      this.context = new AudioContext({ sampleRate: 16000 })
      await this.context.audioWorklet.addModule('/audio-processor.js')
      const source = this.context.createMediaStreamSource(this.stream)
      this.node = new AudioWorkletNode(this.context, 'sentinel-audio-processor')
      this.node.port.onmessage = (event: MessageEvent<{ type: string; samples: Float32Array }>) => {
        if (event.data.type === 'window') this.onWindow(event.data.samples)
      }
      source.connect(this.node)
    } catch (err) {
      this.stop()
      throw err
    }
  }

  stop(): void {
    this.node?.disconnect()
    this.stream?.getTracks().forEach(t => t.stop())
    this.context?.close()
    this.node = null
    this.stream = null
    this.context = null
  }
}
