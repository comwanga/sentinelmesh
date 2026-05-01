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
