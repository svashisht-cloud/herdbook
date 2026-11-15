import { describe, expect, it } from 'vitest'
import { SNAP_DISTANCE_M } from './smoothing'
import { TRAIL_FADE_TAU_MS, TRAIL_MAX_POINTS, TRAIL_WINDOW_MS, addPoint, fadeAt, prune, segments, type TrailPoint } from './trail'

const pt = (x: number, t: number, breakBefore = false): TrailPoint => ({ x, y: 0, t, breakBefore })

describe('addPoint', () => {
  it('appends in order with the arrival time', () => {
    let b: TrailPoint[] = []
    b = addPoint(b, { x: 0, y: 0 }, 1000)
    b = addPoint(b, { x: 1, y: 0 }, 1500)
    expect(b.map((p) => [p.x, p.t])).toEqual([[0, 1000], [1, 1500]])
    expect(b.every((p) => !p.breakBefore)).toBe(true)
  })
  it('ignores a duplicate position', () => {
    const b = addPoint([pt(1, 0)], { x: 1, y: 0 }, 500)
    expect(b).toHaveLength(1)
  })
  it('marks a jump over the snap distance as a break', () => {
    const b = addPoint([pt(0, 0)], { x: SNAP_DISTANCE_M + 1, y: 0 }, 500)
    expect(b[1].breakBefore).toBe(true)
    const near = addPoint([pt(0, 0)], { x: SNAP_DISTANCE_M - 1, y: 0 }, 500)
    expect(near[1].breakBefore).toBe(false)
  })
  it('does not mutate the input buffer', () => {
    const before = [pt(0, 0)]
    addPoint(before, { x: 1, y: 0 }, 500)
    expect(before).toHaveLength(1)
  })
})

describe('prune', () => {
  it('drops points older than the window', () => {
    const now = 100_000
    const b = prune([pt(0, now - TRAIL_WINDOW_MS - 1), pt(1, now - TRAIL_WINDOW_MS + 1), pt(2, now)], now)
    expect(b.map((p) => p.x)).toEqual([1, 2])
  })
  it('caps the length, keeping the newest', () => {
    const now = 10_000
    const many = Array.from({ length: TRAIL_MAX_POINTS + 30 }, (_, i) => pt(i * 0.1, now))
    const b = prune(many, now)
    expect(b).toHaveLength(TRAIL_MAX_POINTS)
    expect(b[b.length - 1]).toBe(many[many.length - 1])
  })
})

describe('segments and fade', () => {
  it('fade is 1 for new points and 0 at the end of the window', () => {
    expect(fadeAt(1000, 1000)).toBe(1)
    expect(fadeAt(1000, 1000 + TRAIL_WINDOW_MS)).toBe(0)
  })
  it('fades quickly: under 40% at 5 s and under 6% at 15 s', () => {
    expect(TRAIL_FADE_TAU_MS).toBe(5000)
    expect(fadeAt(0, 5_000)).toBeLessThan(0.4)
    expect(fadeAt(0, 15_000)).toBeLessThan(0.06)
  })
  it('keeps falling with age', () => {
    let prev = 2
    for (let age = 0; age <= TRAIL_WINDOW_MS; age += 1000) {
      const f = fadeAt(0, age)
      expect(f).toBeLessThan(prev)
      prev = f
    }
  })
  it('skips the segment across a break', () => {
    const b = [pt(0, 0), pt(1, 500), pt(50, 1000, true), pt(51, 1500)]
    const s = segments(b, 1500)
    expect(s.map((x) => [x.a.x, x.b.x])).toEqual([[0, 1], [50, 51]])
  })
  it('newer segments are brighter', () => {
    const s = segments([pt(0, 0), pt(1, 10_000), pt(2, 20_000)], 20_000)
    expect(s[1].fade).toBeGreaterThan(s[0].fade)
  })
})
