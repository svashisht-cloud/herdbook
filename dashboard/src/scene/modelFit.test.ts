import { describe, expect, it } from 'vitest'
import { TARGET_FOOTPRINT_M, fitScale, fitTransform, type Bounds } from './modelFit'

const cfg = { scale: 1, yawOffset: 0, groundOffset: 0 }
const box = (min: Bounds['min'], max: Bounds['max']): Bounds => ({ min, max })

describe('fitScale', () => {
  it('scales a tiny model up to the target footprint', () => {
    expect(fitScale(box([0, 0, 0], [0.03, 0.01, 0.02])) * 0.03).toBeCloseTo(TARGET_FOOTPRINT_M)
  })
  it('scales a huge model down', () => {
    expect(fitScale(box([-100, 0, -50], [100, 10, 50]))).toBeCloseTo(0.01)
  })
  it('uses the larger of x and z, ignoring height', () => {
    expect(fitScale(box([0, 0, 0], [1, 50, 4]))).toBeCloseTo(0.5)
  })
  it('returns 1 for an empty or degenerate box', () => {
    expect(fitScale(box([0, 0, 0], [0, 1, 0]))).toBe(1)
    expect(fitScale(box([Infinity, Infinity, Infinity], [-Infinity, -Infinity, -Infinity]))).toBe(1)
  })
})

describe('fitTransform', () => {
  it('multiplies config.scale on top of the fit', () => {
    const b = box([0, 0, 0], [4, 1, 1])
    expect(fitTransform(b, { ...cfg, scale: 2 }).scale).toBeCloseTo(1)
  })
  it('centres x/z and puts the lowest point on the ground', () => {
    const b = box([1, -0.5, 3], [5, 1, 5]) // 4 m long -> scale 0.5
    const f = fitTransform(b, cfg)
    expect(f.scale).toBeCloseTo(0.5)
    expect(f.offset[0]).toBeCloseTo(-1.5) // centre x 3 * 0.5
    expect(f.offset[1]).toBeCloseTo(0.25) // min y -0.5 * 0.5 lifted to 0
    expect(f.offset[2]).toBeCloseTo(-2) // centre z 4 * 0.5
  })
  it('adds groundOffset and passes yawOffset through', () => {
    const f = fitTransform(box([-1, 0, -1], [1, 1, 1]), { ...cfg, groundOffset: 0.2, yawOffset: Math.PI / 2 })
    expect(f.offset[1]).toBeCloseTo(0.2)
    expect(f.yaw).toBeCloseTo(Math.PI / 2)
  })
  it('never produces NaN for a degenerate box', () => {
    const f = fitTransform(box([Infinity, Infinity, Infinity], [-Infinity, -Infinity, -Infinity]), cfg)
    expect([f.scale, ...f.offset].every(Number.isFinite)).toBe(true)
  })
})
