# Acoustic Threat Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add on-device acoustic threat detection to the SentinelMesh PWA using Web Audio API + TensorFlow.js, enabling real-time alerts for gunshots, explosions, screaming, and glass breaking without sending audio to any server.

**Architecture:** The PWA requests microphone access, feeds audio through an `AudioWorkletProcessor` at 16kHz, batches samples into 0.96-second windows (15,360 samples), runs them through YAMNet (loaded from TensorFlow Hub as a TF.js GraphModel), and maps the top-scoring output to a SentinelMesh threat category. On a detection ≥0.80 confidence, it dispatches a Redux alert and silently POSTs a `PENDING` community report to the existing `/api/reports` endpoint. No audio ever leaves the browser.

**Tech Stack:** Web Audio API (AudioContext, AudioWorklet), `@tensorflow/tfjs` (browser), `@tensorflow/tfjs-backend-webgl`, react-map-gl (existing), Redux Toolkit (existing), existing `/api/reports` endpoint (no new backend)

**Target directory:** `apps/pwa/` (React + Vite + TypeScript)

---

## Prerequisites (manual steps before starting tasks)

**1. Install TensorFlow.js:**
```bash
cd apps/pwa
npm install @tensorflow/tfjs @tensorflow/tfjs-backend-webgl
```

**2. Download YAMNet TF.js model into public assets:**
```bash
# Creates apps/pwa/public/yamnet/ with model.json + weight shards
mkdir -p apps/pwa/public/yamnet
# Download from TF Hub (tfjs-format):
# https://tfhub.dev/google/tfjs-model/yamnet/tfjs/1 → download and extract into apps/pwa/public/yamnet/
# Alternatively, load from URL at runtime (see Task 3) — no local download needed if CDN is acceptable
```

For development, the model can be loaded directly from TF Hub CDN:
```
https://tfhub.dev/google/tfjs-model/yamnet/tfjs/1/model.json?tfjs-format=file
```

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `apps/pwa/src/constants/acousticThreats.ts` | Create | YAMNet class index → threat category mapping + `getThreatFromScores` |
| `apps/pwa/public/audio-processor.js` | Create | AudioWorkletProcessor — runs in audio thread, sends 15360-sample windows to main thread |
| `apps/pwa/src/services/audioCapture.ts` | Create | Sets up AudioContext + AudioWorklet, manages mic stream, emits Float32 windows |
| `apps/pwa/src/services/acousticDetectionService.ts` | Create | TF.js model loading, inference on audio windows |
| `apps/pwa/src/services/reportAutoSubmit.ts` | Create | Wraps acoustic detection into POST /api/reports |
| `apps/pwa/src/store/acousticSlice.ts` | Create | Redux state: isRunning, currentAlert |
| `apps/pwa/src/store/index.ts` | Modify | Register acousticReducer |
| `apps/pwa/src/components/AcousticAlert.tsx` | Create | Dismissable alert banner |
| `apps/pwa/src/App.tsx` | Modify | Mount detection hook, render AcousticAlert |
| `apps/pwa/src/__tests__/acousticThreats.test.ts` | Create | Vitest unit tests |
| `apps/pwa/src/__tests__/acousticSlice.test.ts` | Create | Vitest unit tests |
| `apps/pwa/src/__tests__/reportAutoSubmit.test.ts` | Create | Vitest unit tests |

**Note:** The PWA has no test setup yet. Add Vitest + jsdom:
```bash
cd apps/pwa
npm install -D vitest @vitest/coverage-v8 jsdom @testing-library/react @testing-library/user-event
```

Add to `apps/pwa/vite.config.ts`:
```typescript
test: {
  environment: 'jsdom',
  globals: true,
},
```

---

## Task 1: YAMNet threat class mapping constants

**Files:**
- Create: `apps/pwa/src/constants/acousticThreats.ts`
- Test: `apps/pwa/src/__tests__/acousticThreats.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/pwa/src/__tests__/acousticThreats.test.ts
import { describe, test, expect } from 'vitest'
import { getThreatFromScores, DETECTION_THRESHOLD } from '../constants/acousticThreats'

describe('getThreatFromScores', () => {
  test('returns null when all scores are below threshold', () => {
    const scores = new Float32Array(521).fill(0.1)
    expect(getThreatFromScores(scores)).toBeNull()
  })

  test('detects SECURITY_INCIDENT when gunshot class 427 is high', () => {
    const scores = new Float32Array(521).fill(0.0)
    scores[427] = 0.85
    const result = getThreatFromScores(scores)
    expect(result).not.toBeNull()
    expect(result!.category).toBe('SECURITY_INCIDENT')
    expect(result!.label).toBe('Gunshot')
    expect(result!.confidence).toBeCloseTo(0.85)
  })

  test('detects SECURITY_INCIDENT when screaming class 25 is high', () => {
    const scores = new Float32Array(521).fill(0.0)
    scores[25] = 0.82
    const result = getThreatFromScores(scores)
    expect(result).not.toBeNull()
    expect(result!.label).toBe('Screaming')
  })

  test('returns highest-confidence detection when multiple classes exceed threshold', () => {
    const scores = new Float32Array(521).fill(0.0)
    scores[427] = 0.75  // gunshot — below threshold
    scores[25]  = 0.91  // screaming — above
    scores[429] = 0.84  // explosion — above
    const result = getThreatFromScores(scores)
    expect(result!.confidence).toBeCloseTo(0.91)
    expect(result!.label).toBe('Screaming')
  })

  test('DETECTION_THRESHOLD is 0.80', () => {
    expect(DETECTION_THRESHOLD).toBe(0.80)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/pwa && npx vitest run src/__tests__/acousticThreats.test.ts --no-coverage
```
Expected: FAIL — `Cannot find module '../constants/acousticThreats'`

- [ ] **Step 3: Create the constants file**

```typescript
// apps/pwa/src/constants/acousticThreats.ts

export const DETECTION_THRESHOLD = 0.80

// AudioSet class indices — full list:
// https://github.com/tensorflow/models/blob/master/research/audioset/yamnet/yamnet_class_map.csv
export const YAMNET_THREAT_MAP: ReadonlyArray<{
  classIndex: number
  label: string
  category: 'SECURITY_INCIDENT' | 'FIRE' | 'CIVIL_UNREST' | 'ACCIDENT'
}> = [
  { classIndex: 427, label: 'Gunshot',        category: 'SECURITY_INCIDENT' },
  { classIndex: 429, label: 'Explosion',       category: 'SECURITY_INCIDENT' },
  { classIndex: 25,  label: 'Screaming',       category: 'SECURITY_INCIDENT' },
  { classIndex: 26,  label: 'Yell',            category: 'SECURITY_INCIDENT' },
  { classIndex: 60,  label: 'Glass breaking',  category: 'SECURITY_INCIDENT' },
  { classIndex: 345, label: 'Crowd',           category: 'CIVIL_UNREST'      },
  { classIndex: 401, label: 'Fire alarm',      category: 'FIRE'              },
  { classIndex: 402, label: 'Smoke detector',  category: 'FIRE'              },
  { classIndex: 504, label: 'Crash',           category: 'ACCIDENT'          },
  { classIndex: 505, label: 'Car crash',       category: 'ACCIDENT'          },
] as const

export interface ThreatDetection {
  classIndex: number
  label: string
  category: 'SECURITY_INCIDENT' | 'FIRE' | 'CIVIL_UNREST' | 'ACCIDENT'
  confidence: number
}

export function getThreatFromScores(scores: Float32Array): ThreatDetection | null {
  let best: ThreatDetection | null = null

  for (const entry of YAMNET_THREAT_MAP) {
    const confidence = scores[entry.classIndex]
    if (confidence !== undefined && confidence >= DETECTION_THRESHOLD) {
      if (best === null || confidence > best.confidence) {
        best = { ...entry, confidence }
      }
    }
  }

  return best
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/pwa && npx vitest run src/__tests__/acousticThreats.test.ts --no-coverage
```
Expected: PASS — 5 tests passing

- [ ] **Step 5: Commit**

```bash
git add apps/pwa/src/constants/acousticThreats.ts apps/pwa/src/__tests__/acousticThreats.test.ts apps/pwa/package.json apps/pwa/package-lock.json apps/pwa/vite.config.ts
git commit -m "feat: add YAMNet threat class mapping constants (PWA)"
```

---

## Task 2: AudioWorklet processor (audio thread)

**Files:**
- Create: `apps/pwa/public/audio-processor.js`

The AudioWorkletProcessor runs in a dedicated audio thread. It accumulates raw float samples into a 15,360-sample buffer (0.96 s at 16kHz), then posts the buffer to the main thread. This file is served as a static asset.

- [ ] **Step 1: Create the processor**

```javascript
// apps/pwa/public/audio-processor.js
// AudioWorkletProcessor — runs in the audio rendering thread.
// Accumulates 0.96s of 16kHz mono PCM and posts Float32Array windows to the main thread.

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
        // Transfer ownership to avoid copying
        const windowCopy = this._buffer.slice()
        this.port.postMessage({ type: 'window', samples: windowCopy }, [windowCopy.buffer])
        this._offset = 0
      }
    }

    return true // keep processor alive
  }
}

registerProcessor('sentinel-audio-processor', SentinelAudioProcessor)
```

- [ ] **Step 2: Verify the file is in public/**

```bash
ls apps/pwa/public/audio-processor.js
```
Expected: file exists

- [ ] **Step 3: Commit**

```bash
git add apps/pwa/public/audio-processor.js
git commit -m "feat: add AudioWorklet processor for 16kHz PCM windowing"
```

---

## Task 3: Audio capture service

**Files:**
- Create: `apps/pwa/src/services/audioCapture.ts`

Sets up the browser audio pipeline: requests mic, creates AudioContext at 16kHz, loads the AudioWorklet, and invokes a callback with each 15,360-sample window.

- [ ] **Step 1: Create audioCapture.ts**

```typescript
// apps/pwa/src/services/audioCapture.ts

export type AudioWindowCallback = (samples: Float32Array) => void

export class AudioCapture {
  private context: AudioContext | null = null
  private stream: MediaStream | null = null
  private node: AudioWorkletNode | null = null

  constructor(private onWindow: AudioWindowCallback) {}

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })

    // AudioContext at 16kHz — YAMNet's required sample rate
    this.context = new AudioContext({ sampleRate: 16000 })

    await this.context.audioWorklet.addModule('/audio-processor.js')

    const source = this.context.createMediaStreamSource(this.stream)
    this.node = new AudioWorkletNode(this.context, 'sentinel-audio-processor')

    this.node.port.onmessage = (event: MessageEvent<{ type: string; samples: Float32Array }>) => {
      if (event.data.type === 'window') {
        this.onWindow(event.data.samples)
      }
    }

    source.connect(this.node)
    // Do NOT connect node to destination — we don't want mic playback
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
```

No unit test for this file — it relies entirely on browser APIs (`navigator.mediaDevices`, `AudioContext`, `AudioWorkletNode`) that cannot be meaningfully mocked in jsdom. Integration testing is done manually.

- [ ] **Step 2: Commit**

```bash
git add apps/pwa/src/services/audioCapture.ts
git commit -m "feat: add Web Audio API capture service using AudioWorklet"
```

---

## Task 4: Acoustic detection service (TF.js inference)

**Files:**
- Create: `apps/pwa/src/services/acousticDetectionService.ts`

Loads YAMNet as a TF.js GraphModel and runs inference on each audio window.

- [ ] **Step 1: Create acousticDetectionService.ts**

```typescript
// apps/pwa/src/services/acousticDetectionService.ts
import * as tf from '@tensorflow/tfjs'
import '@tensorflow/tfjs-backend-webgl'
import { getThreatFromScores, ThreatDetection } from '../constants/acousticThreats'

// Public TF Hub URL — can be swapped for a self-hosted copy
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
```

- [ ] **Step 2: Commit**

```bash
git add apps/pwa/src/services/acousticDetectionService.ts
git commit -m "feat: add TF.js acoustic detection service using YAMNet"
```

---

## Task 5: Auto-submit acoustic detection as community report

**Files:**
- Create: `apps/pwa/src/services/reportAutoSubmit.ts`
- Test: `apps/pwa/src/__tests__/reportAutoSubmit.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/pwa/src/__tests__/reportAutoSubmit.test.ts
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { ThreatDetection } from '../constants/acousticThreats'

const mockDetection: ThreatDetection = {
  classIndex: 427, label: 'Gunshot', category: 'SECURITY_INCIDENT', confidence: 0.88,
}
const mockLocation = { lat: -1.2921, lng: 36.8219 }

describe('autoSubmitAcousticReport', () => {
  beforeEach(() => vi.restoreAllMocks())

  test('POSTs to /api/reports with correct type, lat, lng', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ report_id: 'test-id', status: 'PENDING' }), { status: 200 })
    )
    const { autoSubmitAcousticReport } = await import('../services/reportAutoSubmit')
    await autoSubmitAcousticReport(mockDetection, mockLocation)

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/reports'),
      expect.objectContaining({ method: 'POST' })
    )
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string)
    expect(body.type).toBe('SECURITY_INCIDENT')
    expect(body.lat).toBe(-1.2921)
    expect(body.lng).toBe(36.8219)
    expect(body.description).toContain('Gunshot')
    expect(body.description).toContain('acoustic')
  })

  test('does not throw when fetch rejects', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('network'))
    const { autoSubmitAcousticReport } = await import('../services/reportAutoSubmit')
    await expect(autoSubmitAcousticReport(mockDetection, mockLocation)).resolves.not.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/pwa && npx vitest run src/__tests__/reportAutoSubmit.test.ts --no-coverage
```
Expected: FAIL

- [ ] **Step 3: Implement reportAutoSubmit.ts**

```typescript
// apps/pwa/src/services/reportAutoSubmit.ts
import { ThreatDetection } from '../constants/acousticThreats'

const API_BASE = import.meta.env['VITE_API_BASE_URL'] as string ?? ''

interface Location { lat: number; lng: number }

export async function autoSubmitAcousticReport(
  detection: ThreatDetection,
  location: Location,
): Promise<void> {
  const description =
    `[Acoustic detection] ${detection.label} detected in browser ` +
    `(confidence: ${Math.round(detection.confidence * 100)}%). ` +
    `Auto-submitted for community verification — please confirm if you are nearby.`

  try {
    const response = await fetch(`${API_BASE}/api/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: detection.category,
        description,
        lat: location.lat,
        lng: location.lng,
        timestamp: Date.now(),
      }),
    })
    if (!response.ok) {
      console.warn('[autoSubmit] server rejected acoustic report:', response.status)
    }
  } catch (err) {
    console.warn('[autoSubmit] acoustic report failed (offline?):', err)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/pwa && npx vitest run src/__tests__/reportAutoSubmit.test.ts --no-coverage
```
Expected: PASS — 2 tests passing

- [ ] **Step 5: Commit**

```bash
git add apps/pwa/src/services/reportAutoSubmit.ts apps/pwa/src/__tests__/reportAutoSubmit.test.ts
git commit -m "feat: add acoustic auto-submit for community reports (PWA)"
```

---

## Task 6: Redux slice for acoustic detection state

**Files:**
- Create: `apps/pwa/src/store/acousticSlice.ts`
- Modify: `apps/pwa/src/store/index.ts`
- Test: `apps/pwa/src/__tests__/acousticSlice.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/pwa/src/__tests__/acousticSlice.test.ts
import { describe, test, expect } from 'vitest'
import acousticReducer, {
  detectionStarted, detectionStopped, detectionReceived, alertDismissed,
} from '../store/acousticSlice'
import { ThreatDetection } from '../constants/acousticThreats'

const mockDetection: ThreatDetection = {
  classIndex: 427, label: 'Gunshot', category: 'SECURITY_INCIDENT', confidence: 0.88,
}

describe('acousticSlice', () => {
  test('initial state is correct', () => {
    expect(acousticReducer(undefined, { type: '@@INIT' })).toEqual({
      isRunning: false, currentAlert: null, lastDetectionAt: null,
    })
  })
  test('detectionStarted sets isRunning true', () => {
    const state = acousticReducer(undefined, detectionStarted())
    expect(state.isRunning).toBe(true)
  })
  test('detectionStopped sets isRunning false', () => {
    const state = acousticReducer({ isRunning: true, currentAlert: null, lastDetectionAt: null }, detectionStopped())
    expect(state.isRunning).toBe(false)
  })
  test('detectionReceived sets currentAlert and lastDetectionAt', () => {
    const state = acousticReducer(undefined, detectionReceived(mockDetection))
    expect(state.currentAlert).toEqual(mockDetection)
    expect(state.lastDetectionAt).not.toBeNull()
  })
  test('alertDismissed clears currentAlert', () => {
    const withAlert = { isRunning: false, currentAlert: mockDetection, lastDetectionAt: Date.now() }
    expect(acousticReducer(withAlert, alertDismissed()).currentAlert).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/pwa && npx vitest run src/__tests__/acousticSlice.test.ts --no-coverage
```
Expected: FAIL

- [ ] **Step 3: Create acousticSlice.ts**

```typescript
// apps/pwa/src/store/acousticSlice.ts
import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { ThreatDetection } from '../constants/acousticThreats'

interface AcousticState {
  isRunning: boolean
  currentAlert: ThreatDetection | null
  lastDetectionAt: number | null
}

const initialState: AcousticState = {
  isRunning: false,
  currentAlert: null,
  lastDetectionAt: null,
}

const acousticSlice = createSlice({
  name: 'acoustic',
  initialState,
  reducers: {
    detectionStarted(state) { state.isRunning = true },
    detectionStopped(state) { state.isRunning = false },
    detectionReceived(state, action: PayloadAction<ThreatDetection>) {
      state.currentAlert = action.payload
      state.lastDetectionAt = Date.now()
    },
    alertDismissed(state) { state.currentAlert = null },
  },
})

export const { detectionStarted, detectionStopped, detectionReceived, alertDismissed } =
  acousticSlice.actions
export default acousticSlice.reducer
```

- [ ] **Step 4: Register in store/index.ts**

In `apps/pwa/src/store/index.ts`, import and add:
```typescript
import acousticReducer from './acousticSlice'
// inside configureStore reducer map:
acoustic: acousticReducer,
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd apps/pwa && npx vitest run src/__tests__/acousticSlice.test.ts --no-coverage
```
Expected: PASS — 5 tests passing

- [ ] **Step 6: Commit**

```bash
git add apps/pwa/src/store/acousticSlice.ts apps/pwa/src/store/index.ts apps/pwa/src/__tests__/acousticSlice.test.ts
git commit -m "feat: add acoustic detection Redux slice (PWA)"
```

---

## Task 7: AcousticAlert banner component

**Files:**
- Create: `apps/pwa/src/components/AcousticAlert.tsx`

Plain React component (no React Native — pure HTML/CSS).

- [ ] **Step 1: Create AcousticAlert.tsx**

```tsx
// apps/pwa/src/components/AcousticAlert.tsx
import { useEffect } from 'react'
import { ThreatDetection } from '../constants/acousticThreats'

const CATEGORY_COLOUR: Record<string, string> = {
  SECURITY_INCIDENT: '#FF2D2D',
  FIRE:              '#FF8C00',
  CIVIL_UNREST:      '#FF8C00',
  ACCIDENT:          '#FFD700',
}

interface Props {
  detection: ThreatDetection | null
  onDismiss: () => void
}

export function AcousticAlert({ detection, onDismiss }: Props) {
  useEffect(() => {
    if (!detection) return
    const timer = setTimeout(onDismiss, 30_000)
    return () => clearTimeout(timer)
  }, [detection, onDismiss])

  if (!detection) return null

  const bg = CATEGORY_COLOUR[detection.category] ?? '#FF2D2D'

  return (
    <div style={{
      position: 'absolute', top: 56, left: 12, right: 12, zIndex: 20,
      background: bg, borderRadius: 8, padding: '12px 16px',
      display: 'flex', alignItems: 'flex-start', gap: 12,
      boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ color: '#fff', fontWeight: 700, fontSize: 15, fontFamily: 'sans-serif' }}>
          ⚠ {detection.label} detected nearby
        </div>
        <div style={{ color: 'rgba(255,255,255,0.9)', fontSize: 12, marginTop: 3, fontFamily: 'sans-serif' }}>
          Confidence: {Math.round(detection.confidence * 100)}%
        </div>
        <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: 11, marginTop: 4, fontFamily: 'sans-serif' }}>
          Submitted for community verification. Stay alert.
        </div>
      </div>
      <button
        data-testid="acoustic-dismiss"
        onClick={onDismiss}
        style={{
          background: 'none', border: 'none', color: '#fff',
          fontSize: 20, fontWeight: 700, cursor: 'pointer', padding: 0,
        }}
      >
        ✕
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/pwa/src/components/AcousticAlert.tsx
git commit -m "feat: add AcousticAlert banner component (PWA)"
```

---

## Task 8: Wire acoustic detection into App.tsx

**Files:**
- Modify: `apps/pwa/src/App.tsx`

- [ ] **Step 1: Update App.tsx**

```tsx
// apps/pwa/src/App.tsx
import { useEffect, useCallback } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import SafetyMap from './components/SafetyMap'
import { AcousticAlert } from './components/AcousticAlert'
import { useWsConnection } from './services/websocket'
import { AudioCapture } from './services/audioCapture'
import { AcousticDetectionService } from './services/acousticDetectionService'
import { autoSubmitAcousticReport } from './services/reportAutoSubmit'
import { detectionReceived, alertDismissed, detectionStarted, detectionStopped } from './store/acousticSlice'
import type { RootState } from './store'

export default function App() {
  useWsConnection()
  const dispatch = useDispatch()
  const currentAlert = useSelector((s: RootState) => s.acoustic.currentAlert)

  const handleDismiss = useCallback(() => dispatch(alertDismissed()), [dispatch])

  useEffect(() => {
    let capture: AudioCapture | null = null
    let detector: AcousticDetectionService | null = null

    async function start() {
      detector = new AcousticDetectionService((detection) => {
        dispatch(detectionReceived(detection))
        // Auto-submit using geolocation if available
        navigator.geolocation?.getCurrentPosition((pos) => {
          autoSubmitAcousticReport(detection, {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          })
        })
      })

      try {
        await detector.init()
        capture = new AudioCapture((samples) => detector?.processWindow(samples))
        await capture.start()
        dispatch(detectionStarted())
      } catch (err) {
        // Microphone denied or model failed to load — fail silently, detection is optional
        console.warn('[acoustic] detection unavailable:', err)
      }
    }

    start()

    return () => {
      capture?.stop()
      dispatch(detectionStopped())
    }
  }, [dispatch])

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      <AcousticAlert detection={currentAlert} onDismiss={handleDismiss} />
      <SafetyMap />
    </div>
  )
}
```

- [ ] **Step 2: Run all tests**

```bash
cd apps/pwa && npx vitest run --no-coverage
```
Expected: All tests passing (acousticThreats, acousticSlice, reportAutoSubmit)

- [ ] **Step 3: Commit**

```bash
git add apps/pwa/src/App.tsx
git commit -m "feat: wire acoustic detection and alert into PWA App"
```

---

## Self-Review

**Spec coverage:**
- [x] On-device inference, no audio sent to server — AudioWorklet + TF.js runs in browser
- [x] Threats: gunshot, explosion, screaming, glass breaking, crowd, fire alarm — Task 1 map
- [x] Detection threshold 0.80 — `DETECTION_THRESHOLD` constant
- [x] Alert on detection — AcousticAlert in App.tsx
- [x] Auto-submits community report — reportAutoSubmit → existing /api/reports
- [x] False positives suppressed by community consensus — report enters PENDING, needs confirmation
- [x] Graceful failure if mic denied — try/catch in App.tsx, detection is optional

**Platform adaptation from original plan:**
- `react-native-audio-record` → Web Audio API + AudioWorklet
- `@tensorflow/tfjs-react-native` → `@tensorflow/tfjs` (browser)
- React Native components → plain React with inline styles
- `@rnmapbox/maps` — not needed for this plan (safe routes plan handles map layer)
- Android Keystore → not applicable (PWA has no persistent key storage)
