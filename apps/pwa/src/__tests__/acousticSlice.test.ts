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
