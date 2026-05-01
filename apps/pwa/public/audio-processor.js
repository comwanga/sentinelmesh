// apps/pwa/public/audio-processor.js
const WINDOW_SAMPLES = 15360 // 0.96 s × 16000 Hz

class SentinelAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this._buffer = new Float32Array(WINDOW_SAMPLES)
    this._offset = 0
  }

  process(inputs) {
    const channel = inputs[0]?.[0]
    if (!channel) return true

    let srcOffset = 0
    while (srcOffset < channel.length) {
      const space = WINDOW_SAMPLES - this._offset
      const toCopy = Math.min(space, channel.length - srcOffset)
      this._buffer.set(channel.subarray(srcOffset, srcOffset + toCopy), this._offset)
      this._offset += toCopy
      srcOffset += toCopy

      if (this._offset === WINDOW_SAMPLES) {
        const windowCopy = this._buffer.slice()
        this.port.postMessage({ type: 'window', samples: windowCopy }, [windowCopy.buffer])
        this._offset = 0
      }
    }

    return true
  }
}

registerProcessor('sentinel-audio-processor', SentinelAudioProcessor)
