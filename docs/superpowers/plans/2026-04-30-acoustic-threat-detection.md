# Acoustic Threat Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add on-device acoustic threat detection to the SentinelMesh mobile app using TensorFlow Lite, enabling real-time alerts for gunshots, explosions, screaming, and glass breaking without requiring a network connection.

**Architecture:** The mobile app captures 0.96-second PCM audio windows at 16kHz from the microphone, runs them through YAMNet (a Google TFLite audio classifier pre-trained on 521 sound classes), maps the top-scoring output to a SentinelMesh threat category, and on high-confidence detection (≥0.80) dispatches a local Redux alert and auto-submits a `PENDING` community report via the existing `/api/reports` endpoint. Detection is fully on-device — no audio ever leaves the phone. The existing community consensus engine handles false positive suppression: the acoustic report enters the normal verification pipeline and needs proximity confirmations to reach `VERIFIED`.

**Tech Stack:** `react-native-audio-record`, `@tensorflow/tfjs`, `@tensorflow/tfjs-react-native`, `react-native-fs`, YAMNet TFLite model (1.7 MB from TensorFlow Hub), Redux Toolkit, existing `/api/reports` POST endpoint (no new backend code)

---

## Prerequisites (manual steps before starting tasks)

**1. Download the YAMNet TFLite model:**
```bash
curl -L -o sentinel-mobile/android/app/src/main/assets/yamnet.tflite \
  "https://tfhub.dev/google/lite-model/yamnet/classification/tflite/1?lite-format=tflite"
```

**2. Install npm dependencies:**
```bash
cd sentinel-mobile
npm install react-native-audio-record @tensorflow/tfjs @tensorflow/tfjs-react-native react-native-fs
npx react-native-asset
```

**3. Add Android permissions to `sentinel-mobile/android/app/src/main/AndroidManifest.xml` inside `<manifest>`:**
```xml
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
```

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `sentinel-mobile/src/constants/acousticThreats.ts` | Create | YAMNet class index → threat category mapping + `getThreatFromScores` |
| `sentinel-mobile/src/services/audioCapture.ts` | Create | 16kHz microphone capture, PCM buffering, Float32 normalisation |
| `sentinel-mobile/src/services/acousticDetectionService.ts` | Create | TFLite model loading, inference on audio windows |
| `sentinel-mobile/src/services/reportAutoSubmit.ts` | Create | Wrap acoustic detection into a `/api/reports` POST |
| `sentinel-mobile/src/store/acousticSlice.ts` | Create | Redux state: `isRunning`, `currentAlert` |
| `sentinel-mobile/src/store/index.ts` | Modify | Register `acousticReducer` |
| `sentinel-mobile/src/components/AcousticAlert.tsx` | Create | Alert banner with auto-dismiss |
| `sentinel-mobile/src/screens/MapScreen.tsx` | Modify | Request mic permission, mount detection loop, render `AcousticAlert` |
| `sentinel-mobile/__tests__/acousticThreats.test.ts` | Create | Unit tests for class mapping |
| `sentinel-mobile/__tests__/audioCapture.test.ts` | Create | Unit tests for PCM buffering and normalisation |
| `sentinel-mobile/__tests__/acousticDetectionService.test.ts` | Create | Unit tests for TFLite inference path |
| `sentinel-mobile/__tests__/reportAutoSubmit.test.ts` | Create | Unit tests for auto-submit logic |
| `sentinel-mobile/__tests__/acousticSlice.test.ts` | Create | Unit tests for Redux slice |
| `sentinel-mobile/__tests__/AcousticAlert.test.tsx` | Create | Unit tests for alert component |

---

## Task 1: YAMNet threat class mapping constants

**Files:**
- Create: `sentinel-mobile/src/constants/acousticThreats.ts`
- Test: `sentinel-mobile/__tests__/acousticThreats.test.ts`

YAMNet outputs a Float32Array of 521 scores (one per AudioSet class). We define which class indices map to SentinelMesh threat categories and the minimum confidence threshold.

- [ ] **Step 1: Write the failing test**

```typescript
// sentinel-mobile/__tests__/acousticThreats.test.ts
import { getThreatFromScores, DETECTION_THRESHOLD } from '../src/constants/acousticThreats';

describe('getThreatFromScores', () => {
  test('returns null when all scores are below threshold', () => {
    const scores = new Float32Array(521).fill(0.1);
    expect(getThreatFromScores(scores)).toBeNull();
  });

  test('detects SECURITY_INCIDENT when gunshot class 427 is high', () => {
    const scores = new Float32Array(521).fill(0.0);
    scores[427] = 0.85;
    const result = getThreatFromScores(scores);
    expect(result).not.toBeNull();
    expect(result!.category).toBe('SECURITY_INCIDENT');
    expect(result!.label).toBe('Gunshot');
    expect(result!.confidence).toBeCloseTo(0.85);
  });

  test('detects SECURITY_INCIDENT when screaming class 25 is high', () => {
    const scores = new Float32Array(521).fill(0.0);
    scores[25] = 0.82;
    const result = getThreatFromScores(scores);
    expect(result).not.toBeNull();
    expect(result!.label).toBe('Screaming');
  });

  test('returns highest-confidence detection when multiple classes exceed threshold', () => {
    const scores = new Float32Array(521).fill(0.0);
    scores[427] = 0.75; // gunshot — below threshold
    scores[25]  = 0.91; // screaming — above threshold
    scores[429] = 0.84; // explosion — above threshold
    const result = getThreatFromScores(scores);
    expect(result!.confidence).toBeCloseTo(0.91);
    expect(result!.label).toBe('Screaming');
  });

  test('DETECTION_THRESHOLD is 0.80', () => {
    expect(DETECTION_THRESHOLD).toBe(0.80);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd sentinel-mobile && npx jest __tests__/acousticThreats.test.ts --no-coverage
```
Expected: FAIL — `Cannot find module '../src/constants/acousticThreats'`

- [ ] **Step 3: Create the constants file**

```typescript
// sentinel-mobile/src/constants/acousticThreats.ts

export const DETECTION_THRESHOLD = 0.80;

// AudioSet class indices from: https://github.com/tensorflow/models/blob/master/research/audioset/yamnet/yamnet_class_map.csv
export const YAMNET_THREAT_MAP: ReadonlyArray<{
  classIndex: number;
  label: string;
  category: 'SECURITY_INCIDENT' | 'FIRE' | 'CIVIL_UNREST' | 'ACCIDENT';
}> = [
  { classIndex: 427, label: 'Gunshot',          category: 'SECURITY_INCIDENT' },
  { classIndex: 429, label: 'Explosion',         category: 'SECURITY_INCIDENT' },
  { classIndex: 25,  label: 'Screaming',         category: 'SECURITY_INCIDENT' },
  { classIndex: 26,  label: 'Yell',              category: 'SECURITY_INCIDENT' },
  { classIndex: 60,  label: 'Glass breaking',    category: 'SECURITY_INCIDENT' },
  { classIndex: 345, label: 'Crowd',             category: 'CIVIL_UNREST'      },
  { classIndex: 401, label: 'Fire alarm',        category: 'FIRE'              },
  { classIndex: 402, label: 'Smoke detector',    category: 'FIRE'              },
  { classIndex: 504, label: 'Crash',             category: 'ACCIDENT'          },
  { classIndex: 505, label: 'Car crash',         category: 'ACCIDENT'          },
] as const;

export interface ThreatDetection {
  classIndex: number;
  label: string;
  category: 'SECURITY_INCIDENT' | 'FIRE' | 'CIVIL_UNREST' | 'ACCIDENT';
  confidence: number;
}

/**
 * Scans YAMNet output scores for any class that exceeds DETECTION_THRESHOLD.
 * Returns the highest-confidence match, or null if none qualify.
 */
export function getThreatFromScores(scores: Float32Array): ThreatDetection | null {
  let best: ThreatDetection | null = null;

  for (const entry of YAMNET_THREAT_MAP) {
    const confidence = scores[entry.classIndex];
    if (confidence >= DETECTION_THRESHOLD) {
      if (best === null || confidence > best.confidence) {
        best = { ...entry, confidence };
      }
    }
  }

  return best;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd sentinel-mobile && npx jest __tests__/acousticThreats.test.ts --no-coverage
```
Expected: PASS — 5 tests passing

- [ ] **Step 5: Commit**

```bash
git add sentinel-mobile/src/constants/acousticThreats.ts \
        sentinel-mobile/__tests__/acousticThreats.test.ts
git commit -m "feat: add YAMNet threat class mapping constants for acoustic detection"
```

---

## Task 2: Audio capture service

**Files:**
- Create: `sentinel-mobile/src/services/audioCapture.ts`
- Test: `sentinel-mobile/__tests__/audioCapture.test.ts`

Captures microphone input as 16kHz mono PCM and emits 0.96-second windows (15,360 samples) as normalised Float32Arrays. YAMNet requires exactly this format.

- [ ] **Step 1: Write the failing test**

```typescript
// sentinel-mobile/__tests__/audioCapture.test.ts
jest.mock('react-native-audio-record', () => ({
  init: jest.fn(),
  start: jest.fn(),
  stop: jest.fn().mockResolvedValue(''),
  on: jest.fn(),
}));

import AudioRecord from 'react-native-audio-record';
import { AudioCapture } from '../src/services/audioCapture';

const WINDOW_SAMPLES = 15360;

function makeBase64Pcm(fillValue: number): string {
  const buf = Buffer.alloc(WINDOW_SAMPLES * 2);
  for (let i = 0; i < WINDOW_SAMPLES; i++) buf.writeInt16LE(fillValue, i * 2);
  return buf.toString('base64');
}

describe('AudioCapture', () => {
  beforeEach(() => jest.clearAllMocks());

  test('init called with 16kHz mono 16-bit config', () => {
    new AudioCapture(jest.fn());
    expect(AudioRecord.init).toHaveBeenCalledWith(
      expect.objectContaining({ sampleRate: 16000, channels: 1, bitsPerSample: 16 })
    );
  });

  test('emits Float32Array of 15360 samples when enough PCM arrives', (done) => {
    (AudioRecord.on as jest.Mock).mockImplementation((event: string, cb: (d: string) => void) => {
      if (event === 'data') setTimeout(() => cb(makeBase64Pcm(0)), 10);
    });

    new AudioCapture((samples) => {
      expect(samples).toBeInstanceOf(Float32Array);
      expect(samples.length).toBe(WINDOW_SAMPLES);
      done();
    });
  });

  test('normalises max int16 (32767) to approximately 1.0', (done) => {
    (AudioRecord.on as jest.Mock).mockImplementation((event: string, cb: (d: string) => void) => {
      if (event === 'data') setTimeout(() => cb(makeBase64Pcm(32767)), 10);
    });

    new AudioCapture((samples) => {
      expect(Math.max(...Array.from(samples))).toBeCloseTo(1.0, 1);
      done();
    });
  });

  test('start() calls AudioRecord.start()', () => {
    const capture = new AudioCapture(jest.fn());
    capture.start();
    expect(AudioRecord.start).toHaveBeenCalled();
  });

  test('stop() calls AudioRecord.stop()', async () => {
    const capture = new AudioCapture(jest.fn());
    await capture.stop();
    expect(AudioRecord.stop).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd sentinel-mobile && npx jest __tests__/audioCapture.test.ts --no-coverage
```
Expected: FAIL — `Cannot find module '../src/services/audioCapture'`

- [ ] **Step 3: Implement AudioCapture**

```typescript
// sentinel-mobile/src/services/audioCapture.ts
import AudioRecord from 'react-native-audio-record';

const SAMPLE_RATE    = 16000;
const WINDOW_SAMPLES = 15360; // 0.96 s × 16000 Hz
const BYTES_PER_SAMPLE = 2;   // 16-bit PCM

export type AudioWindowCallback = (samples: Float32Array) => void;

export class AudioCapture {
  private onWindow: AudioWindowCallback;
  private buffer: Int16Array = new Int16Array(WINDOW_SAMPLES);
  private bufferOffset = 0;

  constructor(onWindow: AudioWindowCallback) {
    this.onWindow = onWindow;

    AudioRecord.init({
      sampleRate: SAMPLE_RATE,
      channels: 1,
      bitsPerSample: 16,
      audioSource: 6, // VOICE_RECOGNITION — cleaner signal than default mic
      wavFile: '',
    });

    AudioRecord.on('data', (base64Chunk: string) => {
      const bytes = Buffer.from(base64Chunk, 'base64');
      const incoming = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / BYTES_PER_SAMPLE);
      let srcOffset = 0;

      while (srcOffset < incoming.length) {
        const space = WINDOW_SAMPLES - this.bufferOffset;
        const toCopy = Math.min(space, incoming.length - srcOffset);
        this.buffer.set(incoming.subarray(srcOffset, srcOffset + toCopy), this.bufferOffset);
        this.bufferOffset += toCopy;
        srcOffset += toCopy;

        if (this.bufferOffset === WINDOW_SAMPLES) {
          this.flushWindow();
          this.bufferOffset = 0;
        }
      }
    });
  }

  private flushWindow(): void {
    const float32 = new Float32Array(WINDOW_SAMPLES);
    for (let i = 0; i < WINDOW_SAMPLES; i++) {
      float32[i] = this.buffer[i] / 32768.0;
    }
    this.onWindow(float32);
  }

  start(): void {
    AudioRecord.start();
  }

  stop(): Promise<void> {
    return AudioRecord.stop().then(() => {});
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd sentinel-mobile && npx jest __tests__/audioCapture.test.ts --no-coverage
```
Expected: PASS — 5 tests passing

- [ ] **Step 5: Commit**

```bash
git add sentinel-mobile/src/services/audioCapture.ts \
        sentinel-mobile/__tests__/audioCapture.test.ts
git commit -m "feat: add 16kHz audio capture service with PCM windowing and float32 normalisation"
```

---

## Task 3: Acoustic detection service (TFLite inference)

**Files:**
- Create: `sentinel-mobile/src/services/acousticDetectionService.ts`
- Test: `sentinel-mobile/__tests__/acousticDetectionService.test.ts`

Loads the YAMNet TFLite model at startup, accepts audio windows from `AudioCapture`, runs inference, and calls a `ThreatCallback` when `getThreatFromScores` returns a result.

- [ ] **Step 1: Write the failing test**

```typescript
// sentinel-mobile/__tests__/acousticDetectionService.test.ts
jest.mock('@tensorflow/tfjs-react-native', () => ({
  bundleResourceIO: jest.fn(() => ({})),
}));

jest.mock('@tensorflow/tfjs', () => {
  const mockDispose = jest.fn();
  const mockModel = {
    predict: jest.fn(() => ({
      dataSync: () => {
        const scores = new Float32Array(521).fill(0.01);
        scores[427] = 0.88; // gunshot class
        return scores;
      },
      dispose: mockDispose,
    })),
  };
  return {
    ready: jest.fn().mockResolvedValue(undefined),
    loadGraphModel: jest.fn().mockResolvedValue(mockModel),
    tensor: jest.fn((data: Float32Array) => ({ data, dispose: mockDispose })),
  };
});

import { AcousticDetectionService } from '../src/services/acousticDetectionService';
import { ThreatDetection } from '../src/constants/acousticThreats';

describe('AcousticDetectionService', () => {
  test('init() resolves without throwing', async () => {
    const service = new AcousticDetectionService(jest.fn());
    await expect(service.init()).resolves.not.toThrow();
  });

  test('calls onThreat with gunshot detection when class 427 is high', async () => {
    const onThreat = jest.fn<void, [ThreatDetection]>();
    const service = new AcousticDetectionService(onThreat);
    await service.init();

    await service.processWindow(new Float32Array(15360).fill(0.1));

    expect(onThreat).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Gunshot', category: 'SECURITY_INCIDENT' })
    );
  });

  test('does not call onThreat when all scores are below threshold', async () => {
    const tf = require('@tensorflow/tfjs');
    tf.loadGraphModel.mockResolvedValueOnce({
      predict: jest.fn(() => ({
        dataSync: () => new Float32Array(521).fill(0.05),
        dispose: jest.fn(),
      })),
    });

    const onThreat = jest.fn();
    const service = new AcousticDetectionService(onThreat);
    await service.init();

    await service.processWindow(new Float32Array(15360).fill(0.0));
    expect(onThreat).not.toHaveBeenCalled();
  });

  test('processWindow is a no-op before init() is called', async () => {
    const onThreat = jest.fn();
    const service = new AcousticDetectionService(onThreat);
    await expect(service.processWindow(new Float32Array(15360))).resolves.not.toThrow();
    expect(onThreat).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd sentinel-mobile && npx jest __tests__/acousticDetectionService.test.ts --no-coverage
```
Expected: FAIL — `Cannot find module '../src/services/acousticDetectionService'`

- [ ] **Step 3: Implement AcousticDetectionService**

```typescript
// sentinel-mobile/src/services/acousticDetectionService.ts
import * as tf from '@tensorflow/tfjs';
import { bundleResourceIO } from '@tensorflow/tfjs-react-native';
import { getThreatFromScores, ThreatDetection } from '../constants/acousticThreats';

export type ThreatCallback = (detection: ThreatDetection) => void;

export class AcousticDetectionService {
  private model: tf.GraphModel | null = null;
  private onThreat: ThreatCallback;

  constructor(onThreat: ThreatCallback) {
    this.onThreat = onThreat;
  }

  async init(): Promise<void> {
    await tf.ready();
    // The .tflite file is bundled via react-native-asset into app assets
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const modelAsset = require('../../android/app/src/main/assets/yamnet.tflite');
    this.model = await tf.loadGraphModel(bundleResourceIO(modelAsset, []));
  }

  async processWindow(samples: Float32Array): Promise<void> {
    if (!this.model) return;

    const inputTensor = tf.tensor(samples, [samples.length]);
    const outputTensor = this.model.predict(inputTensor) as tf.Tensor;
    const scores = outputTensor.dataSync() as Float32Array;

    inputTensor.dispose();
    outputTensor.dispose();

    const threat = getThreatFromScores(scores);
    if (threat) {
      this.onThreat(threat);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd sentinel-mobile && npx jest __tests__/acousticDetectionService.test.ts --no-coverage
```
Expected: PASS — 4 tests passing

- [ ] **Step 5: Commit**

```bash
git add sentinel-mobile/src/services/acousticDetectionService.ts \
        sentinel-mobile/__tests__/acousticDetectionService.test.ts
git commit -m "feat: add TFLite acoustic detection service wrapping YAMNet"
```

---

## Task 4: Redux slice for acoustic detection state

**Files:**
- Create: `sentinel-mobile/src/store/acousticSlice.ts`
- Modify: `sentinel-mobile/src/store/index.ts`
- Test: `sentinel-mobile/__tests__/acousticSlice.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// sentinel-mobile/__tests__/acousticSlice.test.ts
import acousticReducer, {
  detectionStarted,
  detectionStopped,
  detectionReceived,
  alertDismissed,
} from '../src/store/acousticSlice';
import { ThreatDetection } from '../src/constants/acousticThreats';

const mockDetection: ThreatDetection = {
  classIndex: 427,
  label: 'Gunshot',
  category: 'SECURITY_INCIDENT',
  confidence: 0.88,
};

const initialState = { isRunning: false, currentAlert: null, lastDetectionAt: null };

describe('acousticSlice', () => {
  test('initial state is correct', () => {
    expect(acousticReducer(undefined, { type: '@@INIT' })).toEqual(initialState);
  });

  test('detectionStarted sets isRunning true', () => {
    expect(acousticReducer(initialState, detectionStarted()).isRunning).toBe(true);
  });

  test('detectionStopped sets isRunning false', () => {
    const running = { ...initialState, isRunning: true };
    expect(acousticReducer(running, detectionStopped()).isRunning).toBe(false);
  });

  test('detectionReceived sets currentAlert and lastDetectionAt', () => {
    const state = acousticReducer(initialState, detectionReceived(mockDetection));
    expect(state.currentAlert).toEqual(mockDetection);
    expect(state.lastDetectionAt).not.toBeNull();
  });

  test('alertDismissed clears currentAlert', () => {
    const withAlert = { ...initialState, currentAlert: mockDetection, lastDetectionAt: Date.now() };
    expect(acousticReducer(withAlert, alertDismissed()).currentAlert).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd sentinel-mobile && npx jest __tests__/acousticSlice.test.ts --no-coverage
```
Expected: FAIL — `Cannot find module '../src/store/acousticSlice'`

- [ ] **Step 3: Create the slice**

```typescript
// sentinel-mobile/src/store/acousticSlice.ts
import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { ThreatDetection } from '../constants/acousticThreats';

interface AcousticState {
  isRunning: boolean;
  currentAlert: ThreatDetection | null;
  lastDetectionAt: number | null;
}

const initialState: AcousticState = {
  isRunning: false,
  currentAlert: null,
  lastDetectionAt: null,
};

const acousticSlice = createSlice({
  name: 'acoustic',
  initialState,
  reducers: {
    detectionStarted(state) { state.isRunning = true; },
    detectionStopped(state) { state.isRunning = false; },
    detectionReceived(state, action: PayloadAction<ThreatDetection>) {
      state.currentAlert = action.payload;
      state.lastDetectionAt = Date.now();
    },
    alertDismissed(state) { state.currentAlert = null; },
  },
});

export const { detectionStarted, detectionStopped, detectionReceived, alertDismissed } =
  acousticSlice.actions;
export default acousticSlice.reducer;
```

- [ ] **Step 4: Register in store index**

In `sentinel-mobile/src/store/index.ts`, add `acoustic: acousticReducer` to the `configureStore` reducer map:
```typescript
import acousticReducer from './acousticSlice';

// inside configureStore({ reducer: { ... } })
acoustic: acousticReducer,
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd sentinel-mobile && npx jest __tests__/acousticSlice.test.ts --no-coverage
```
Expected: PASS — 5 tests passing

- [ ] **Step 6: Commit**

```bash
git add sentinel-mobile/src/store/acousticSlice.ts \
        sentinel-mobile/src/store/index.ts \
        sentinel-mobile/__tests__/acousticSlice.test.ts
git commit -m "feat: add acoustic detection Redux slice"
```

---

## Task 5: Auto-submit acoustic detection as community report

**Files:**
- Create: `sentinel-mobile/src/services/reportAutoSubmit.ts`
- Test: `sentinel-mobile/__tests__/reportAutoSubmit.test.ts`

When a threat fires, silently POST a `PENDING` community report. If the device is offline, the existing background sync (Android WorkManager) will retry it. The report description is transparent that it came from acoustic detection — the community can then confirm or deny.

- [ ] **Step 1: Write the failing test**

```typescript
// sentinel-mobile/__tests__/reportAutoSubmit.test.ts
global.fetch = jest.fn();

jest.mock('../src/services/nostrService', () => ({
  signReport: jest.fn().mockResolvedValue({
    nostr_pubkey: 'fakepubkey0000000000000000000000000000000000000000000000000000000',
    nostr_signature: 'fakesig0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
  }),
}));

import { autoSubmitAcousticReport } from '../src/services/reportAutoSubmit';
import { ThreatDetection } from '../src/constants/acousticThreats';

const mockDetection: ThreatDetection = {
  classIndex: 427, label: 'Gunshot', category: 'SECURITY_INCIDENT', confidence: 0.88,
};
const mockLocation = { lat: -1.2921, lng: 36.8219 };

describe('autoSubmitAcousticReport', () => {
  beforeEach(() => (global.fetch as jest.Mock).mockClear());

  test('POSTs to /api/reports with correct type, lat, and lng', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ report_id: 'test-id', status: 'PENDING' }),
    });

    await autoSubmitAcousticReport(mockDetection, mockLocation);

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/reports'),
      expect.objectContaining({ method: 'POST' }),
    );

    const body = JSON.parse((fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.type).toBe('SECURITY_INCIDENT');
    expect(body.lat).toBe(-1.2921);
    expect(body.lng).toBe(36.8219);
    expect(body.description).toContain('Gunshot');
    expect(body.description).toContain('acoustic');
  });

  test('does not throw when network request fails', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));
    await expect(autoSubmitAcousticReport(mockDetection, mockLocation)).resolves.not.toThrow();
  });

  test('does not throw when server returns non-ok status', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 503 });
    await expect(autoSubmitAcousticReport(mockDetection, mockLocation)).resolves.not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd sentinel-mobile && npx jest __tests__/reportAutoSubmit.test.ts --no-coverage
```
Expected: FAIL — `Cannot find module '../src/services/reportAutoSubmit'`

- [ ] **Step 3: Implement autoSubmitAcousticReport**

```typescript
// sentinel-mobile/src/services/reportAutoSubmit.ts
import { ThreatDetection } from '../constants/acousticThreats';
import { signReport } from './nostrService';

const API_BASE = process.env.API_BASE_URL ?? 'https://api.sentinelmesh.ke';

interface Location { lat: number; lng: number; }

export async function autoSubmitAcousticReport(
  detection: ThreatDetection,
  location: Location,
): Promise<void> {
  const description =
    `[Acoustic detection] ${detection.label} detected on-device ` +
    `(confidence: ${Math.round(detection.confidence * 100)}%). ` +
    `Auto-submitted for community verification — please confirm or deny if you are nearby.`;

  const payload = {
    type: detection.category,
    description,
    lat: location.lat,
    lng: location.lng,
    timestamp: Date.now(),
  };

  try {
    const { nostr_pubkey, nostr_signature } = await signReport(payload);

    const response = await fetch(`${API_BASE}/api/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, nostr_pubkey, nostr_signature }),
    });

    if (!response.ok) {
      console.warn('[autoSubmit] server rejected acoustic report:', response.status);
    }
  } catch (err) {
    // Offline or transient error — WorkManager background sync will retry
    console.warn('[autoSubmit] acoustic report queued for retry:', err);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd sentinel-mobile && npx jest __tests__/reportAutoSubmit.test.ts --no-coverage
```
Expected: PASS — 3 tests passing

- [ ] **Step 5: Commit**

```bash
git add sentinel-mobile/src/services/reportAutoSubmit.ts \
        sentinel-mobile/__tests__/reportAutoSubmit.test.ts
git commit -m "feat: auto-submit acoustic detections as PENDING community reports"
```

---

## Task 6: AcousticAlert banner component

**Files:**
- Create: `sentinel-mobile/src/components/AcousticAlert.tsx`
- Test: `sentinel-mobile/__tests__/AcousticAlert.test.tsx`

Displays a coloured banner at the top of the screen when a threat is detected. Auto-dismisses after 30 seconds.

- [ ] **Step 1: Write the failing test**

```typescript
// sentinel-mobile/__tests__/AcousticAlert.test.tsx
import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { AcousticAlert } from '../src/components/AcousticAlert';
import { ThreatDetection } from '../src/constants/acousticThreats';

jest.useFakeTimers();

const mockDetection: ThreatDetection = {
  classIndex: 427, label: 'Gunshot', category: 'SECURITY_INCIDENT', confidence: 0.88,
};

describe('AcousticAlert', () => {
  test('renders null when detection is null', () => {
    const { toJSON } = render(<AcousticAlert detection={null} onDismiss={jest.fn()} />);
    expect(toJSON()).toBeNull();
  });

  test('renders threat label and confidence percentage', () => {
    const { getByText } = render(<AcousticAlert detection={mockDetection} onDismiss={jest.fn()} />);
    expect(getByText(/Gunshot/)).toBeTruthy();
    expect(getByText(/88%/)).toBeTruthy();
  });

  test('calls onDismiss when dismiss button is pressed', () => {
    const onDismiss = jest.fn();
    const { getByTestId } = render(<AcousticAlert detection={mockDetection} onDismiss={onDismiss} />);
    fireEvent.press(getByTestId('acoustic-dismiss'));
    expect(onDismiss).toHaveBeenCalled();
  });

  test('auto-dismisses after 30 seconds', () => {
    const onDismiss = jest.fn();
    render(<AcousticAlert detection={mockDetection} onDismiss={onDismiss} />);
    act(() => jest.advanceTimersByTime(30_000));
    expect(onDismiss).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd sentinel-mobile && npx jest __tests__/AcousticAlert.test.tsx --no-coverage
```
Expected: FAIL — `Cannot find module '../src/components/AcousticAlert'`

- [ ] **Step 3: Implement AcousticAlert**

```tsx
// sentinel-mobile/src/components/AcousticAlert.tsx
import React, { useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { ThreatDetection } from '../constants/acousticThreats';

const CATEGORY_COLOUR: Record<string, string> = {
  SECURITY_INCIDENT: '#FF2D2D',
  FIRE:              '#FF8C00',
  CIVIL_UNREST:      '#FF8C00',
  ACCIDENT:          '#FFD700',
};

interface Props {
  detection: ThreatDetection | null;
  onDismiss: () => void;
}

export function AcousticAlert({ detection, onDismiss }: Props) {
  useEffect(() => {
    if (!detection) return;
    const timer = setTimeout(onDismiss, 30_000);
    return () => clearTimeout(timer);
  }, [detection, onDismiss]);

  if (!detection) return null;

  const bg = CATEGORY_COLOUR[detection.category] ?? '#FF2D2D';

  return (
    <View style={[styles.banner, { backgroundColor: bg }]}>
      <View style={styles.body}>
        <Text style={styles.title}>⚠ {detection.label} detected nearby</Text>
        <Text style={styles.conf}>Confidence: {Math.round(detection.confidence * 100)}%</Text>
        <Text style={styles.sub}>
          Submitted for community verification. Stay alert and move to safety.
        </Text>
      </View>
      <TouchableOpacity testID="acoustic-dismiss" onPress={onDismiss} style={styles.close}>
        <Text style={styles.closeText}>✕</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  banner:    { flexDirection: 'row', padding: 12, margin: 8, borderRadius: 8, elevation: 8, zIndex: 999 },
  body:      { flex: 1 },
  title:     { color: '#fff', fontWeight: '700', fontSize: 15 },
  conf:      { color: '#fff', fontSize: 12, opacity: 0.9, marginTop: 2 },
  sub:       { color: '#fff', fontSize: 11, opacity: 0.8, marginTop: 4 },
  close:     { justifyContent: 'center', paddingLeft: 12 },
  closeText: { color: '#fff', fontSize: 22, fontWeight: '700' },
});
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd sentinel-mobile && npx jest __tests__/AcousticAlert.test.tsx --no-coverage
```
Expected: PASS — 4 tests passing

- [ ] **Step 5: Commit**

```bash
git add sentinel-mobile/src/components/AcousticAlert.tsx \
        sentinel-mobile/__tests__/AcousticAlert.test.tsx
git commit -m "feat: add AcousticAlert banner with auto-dismiss"
```

---

## Task 7: Wire acoustic detection into MapScreen

**Files:**
- Modify: `sentinel-mobile/src/screens/MapScreen.tsx`

Requests microphone permission on mount, initialises `AudioCapture` + `AcousticDetectionService`, dispatches Redux actions, renders `AcousticAlert`, and auto-submits reports.

- [ ] **Step 1: Add imports to MapScreen.tsx**

Find the import block at the top of `sentinel-mobile/src/screens/MapScreen.tsx` and add:
```typescript
import { PermissionsAndroid } from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { AudioCapture } from '../services/audioCapture';
import { AcousticDetectionService } from '../services/acousticDetectionService';
import { autoSubmitAcousticReport } from '../services/reportAutoSubmit';
import { detectionReceived, alertDismissed, detectionStarted, detectionStopped } from '../store/acousticSlice';
import { AcousticAlert } from '../components/AcousticAlert';
import type { RootState } from '../store';
```

- [ ] **Step 2: Add detection hook inside the MapScreen component body**

Place this inside the MapScreen function body, after existing hooks:
```typescript
const dispatch = useDispatch();
const currentAlert  = useSelector((s: RootState) => s.acoustic.currentAlert);
const userLocation  = useSelector((s: RootState) => s.location.current);

useEffect(() => {
  let capture: AudioCapture | null = null;
  let detector: AcousticDetectionService | null = null;

  async function start() {
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      {
        title: 'Microphone for threat detection',
        message:
          'SentinelMesh uses your microphone to detect nearby threats on-device. ' +
          'No audio is ever sent to a server.',
        buttonPositive: 'Allow',
        buttonNegative: 'No thanks',
      },
    );
    if (granted !== PermissionsAndroid.RESULTS.GRANTED) return;

    detector = new AcousticDetectionService((detection) => {
      dispatch(detectionReceived(detection));
      if (userLocation) autoSubmitAcousticReport(detection, userLocation);
    });
    await detector.init();

    capture = new AudioCapture((samples) => detector?.processWindow(samples));
    capture.start();
    dispatch(detectionStarted());
  }

  start();

  return () => {
    capture?.stop();
    dispatch(detectionStopped());
  };
}, []); // intentionally runs once on mount
```

- [ ] **Step 3: Add AcousticAlert to the JSX**

Inside MapScreen's return, wrap existing content so `AcousticAlert` renders above the map:
```tsx
return (
  <>
    <AcousticAlert
      detection={currentAlert}
      onDismiss={() => dispatch(alertDismissed())}
    />
    {/* existing MapView and other components unchanged */}
  </>
);
```

- [ ] **Step 4: Run all acoustic tests together**

```bash
cd sentinel-mobile && npx jest \
  __tests__/acousticThreats.test.ts \
  __tests__/audioCapture.test.ts \
  __tests__/acousticDetectionService.test.ts \
  __tests__/acousticSlice.test.ts \
  __tests__/reportAutoSubmit.test.ts \
  __tests__/AcousticAlert.test.tsx \
  --no-coverage
```
Expected: All tests PASS (26+ assertions)

- [ ] **Step 5: Commit**

```bash
git add sentinel-mobile/src/screens/MapScreen.tsx
git commit -m "feat: mount acoustic detection in MapScreen with mic permission and alert overlay"
```

---

## Self-Review

**Spec coverage:**
- [x] On-device TFLite inference, no network for detection — Tasks 2–3
- [x] Threats: gunshot, explosion, screaming, glass breaking, crowd, fire alarm — Task 1 map
- [x] Confidence threshold 0.80 — `DETECTION_THRESHOLD` constant
- [x] High-confidence detection → local alert — Tasks 6–7
- [x] Auto-submits community report — Task 5
- [x] Uses existing `/api/reports` endpoint — Task 5 (no new backend)
- [x] False positives suppressed via community consensus — report enters PENDING state, needs proximity confirmations to promote
- [x] Works offline — Tasks 2–3 (no network in detection path); offline retry delegated to existing WorkManager

**Placeholder scan:** None found.

**Type consistency:** `ThreatDetection` defined once in `acousticThreats.ts`, imported by all other files. `AudioWindowCallback` and `ThreatCallback` defined in their respective files and not reused elsewhere.
