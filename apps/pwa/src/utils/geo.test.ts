import { describe, test, expect } from 'vitest'
import { bearingBetween, destinationPoint, pointToLineDistance } from './geo'

describe('bearingBetween', () => {
  test('north: bearing is 0', () => {
    const bearing = bearingBetween({ lat: -1.2921, lng: 36.8219 }, { lat: -1.2000, lng: 36.8219 })
    expect(bearing).toBeCloseTo(0, 0)
  })
  test('east: bearing is approximately 90', () => {
    const bearing = bearingBetween({ lat: -1.2921, lng: 36.8219 }, { lat: -1.2921, lng: 37.0000 })
    expect(bearing).toBeCloseTo(90, 0)
  })
  test('south: bearing is approximately 180', () => {
    const bearing = bearingBetween({ lat: -1.2921, lng: 36.8219 }, { lat: -1.4000, lng: 36.8219 })
    expect(bearing).toBeCloseTo(180, 0)
  })
})

describe('destinationPoint', () => {
  test('moving 1km north returns point approximately 0.009 degrees latitude north', () => {
    const origin = { lat: -1.2921, lng: 36.8219 }
    const dest = destinationPoint(origin, 1, 0)
    expect(dest.lat).toBeGreaterThan(origin.lat)
    expect(dest.lat - origin.lat).toBeCloseTo(0.009, 2)
    expect(dest.lng).toBeCloseTo(origin.lng, 3)
  })
  test('moving 2km east returns point with same latitude and greater longitude', () => {
    const origin = { lat: -1.2921, lng: 36.8219 }
    const dest = destinationPoint(origin, 2, 90)
    expect(dest.lat).toBeCloseTo(origin.lat, 2)
    expect(dest.lng).toBeGreaterThan(origin.lng)
  })
})

describe('pointToLineDistance', () => {
  test('returns 0 when point is on the line', () => {
    const line: [number, number][] = [[36.82, -1.29], [36.84, -1.29]]
    const dist = pointToLineDistance({ lat: -1.29, lng: 36.83 }, line)
    expect(dist).toBeCloseTo(0, 1)
  })
  test('returns positive distance when point is off the line', () => {
    const line: [number, number][] = [[36.82, -1.29], [36.84, -1.29]]
    const dist = pointToLineDistance({ lat: -1.30, lng: 36.83 }, line)
    expect(dist).toBeGreaterThan(0)
  })
  test('distance is in km', () => {
    const line: [number, number][] = [[36.82, -1.30], [36.84, -1.30]]
    const dist = pointToLineDistance({ lat: -1.291, lng: 36.83 }, line)
    expect(dist).toBeCloseTo(1.0, 0)
  })
})
