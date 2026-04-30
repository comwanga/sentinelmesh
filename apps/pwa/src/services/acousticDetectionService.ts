// apps/pwa/src/services/acousticDetectionService.ts
import * as tf from '@tensorflow/tfjs'
import '@tensorflow/tfjs-backend-webgl'
import { getThreatFromScores, ThreatDetection } from '../constants/acousticThreats'

const YAMNET_MODEL_URL =
  'https://tfhub.dev/google/tfjs-model/yamnet/tfjs/1/model.json?tfjs-format=file'

export type ThreatCallback = (detection: ThreatDetection) => void

export class AcousticDetectionService {
  private model: tf.GraphModel | null = null

  constructor(private onThreat: ThreatCallback) {}

  async init(): Promise<void> {
    await tf.ready()
    this.model = await tf.loadGraphModel(YAMNET_MODEL_URL, { fromTFHub: true })
  }

  async processWindow(samples: Float32Array): Promise<void> {
    if (!this.model) return

    const inputTensor = tf.tensor1d(samples)
    const outputTensor = this.model.predict(inputTensor) as tf.Tensor
    const scores = await outputTensor.data() as Float32Array

    inputTensor.dispose()
    outputTensor.dispose()

    const threat = getThreatFromScores(scores)
    if (threat) this.onThreat(threat)
  }
}
