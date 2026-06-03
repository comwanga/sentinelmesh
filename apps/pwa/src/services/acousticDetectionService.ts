// apps/pwa/src/services/acousticDetectionService.ts
import type * as TF from '@tensorflow/tfjs'
import { getThreatFromScores, acousticFingerprint, ThreatDetection } from '../constants/acousticThreats'

const YAMNET_MODEL_URL =
  'https://tfhub.dev/google/tfjs-model/yamnet/tfjs/1/model.json?tfjs-format=file'

export type ThreatCallback = (detection: ThreatDetection) => void

export class AcousticDetectionService {
  private model: TF.GraphModel | null = null
  private tf: typeof TF | null = null

  constructor(private onThreat: ThreatCallback) {}

  async init(): Promise<void> {
    const tf = await import('@tensorflow/tfjs')
    await import('@tensorflow/tfjs-backend-webgl')
    this.tf = tf
    await tf.ready()
    this.model = await tf.loadGraphModel(YAMNET_MODEL_URL, { fromTFHub: true })
  }

  async processWindow(samples: Float32Array): Promise<void> {
    if (!this.model || !this.tf) return
    const tf = this.tf

    const inputTensor = tf.tensor1d(samples)
    let outputTensor: TF.Tensor | null = null
    try {
      const raw = this.model.predict(inputTensor)
      outputTensor = Array.isArray(raw) ? raw[0]! : raw as TF.Tensor
      const scores = await outputTensor.data() as Float32Array
      const threat = getThreatFromScores(scores)
      if (threat) {
        const fingerprint = await acousticFingerprint(scores)
        this.onThreat({ ...threat, fingerprint })
      }
    } finally {
      inputTensor.dispose()
      outputTensor?.dispose()
    }
  }
}
