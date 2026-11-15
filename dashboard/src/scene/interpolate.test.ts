import { describe, expect, it } from 'vitest'
import { INTERP_DELAY_MS, MAX_GAP_MS, MAX_SAMPLES, addSample, poseAt, renderTs, type Track } from './interpolate'
import { SNAP_DISTANCE_M } from './smoothing'

const LAG = 50 // network delay in these tests, ms
const SKEW = 1_000_000 // robot clock far ahead of the browser: interpolation must not care

/** A track of samples every 500 ms moving +1 m in x per sample, robot clock = browser clock + SKEW. */
function track(n: number, start = 0): Track {
  let t: Track = []
  for (let i = 0; i < n; i++) {
    const ts = SKEW + start + i * 500
    t = addSample(t, { ts, x: i, y: 0, heading: 0 }, ts - SKEW + LAG)
  }
  return t
}
/** Browser time at which the render time equals robot time `ts`. */
const browserAt = (ts: number) => ts - SKEW + LAG + INTERP_DELAY_MS

describe('addSample', () => {
  it('ignores repeated and older samples', () => {
    const t = track(3)
    expect(addSample(t, { ts: t[2].ts, x: 9, y: 9, heading: 0 }, 0)).toBe(t)
    expect(addSample(t, { ts: t[0].ts, x: 9, y: 9, heading: 0 }, 0)).toBe(t)
  })
  it('keeps at most MAX_SAMPLES', () => {
    const t = track(MAX_SAMPLES + 5)
    expect(t).toHaveLength(MAX_SAMPLES)
    expect(t[t.length - 1].x).toBe(MAX_SAMPLES + 4)
  })
  it('starts over after a jump bigger than the snap distance', () => {
    const t = addSample(track(3), { ts: SKEW + 5000, x: 2 + SNAP_DISTANCE_M + 1, y: 0, heading: 0 }, 5000 + LAG)
    expect(t).toHaveLength(1)
  })
})

describe('renderTs', () => {
  it('uses the smallest recent lag, so jitter and clock skew cancel out', () => {
    let t: Track = []
    t = addSample(t, { ts: SKEW, x: 0, y: 0, heading: 0 }, 300) // a late arrival
    t = addSample(t, { ts: SKEW + 500, x: 1, y: 0, heading: 0 }, 500 + LAG)
    expect(renderTs(t, 1000)).toBe(SKEW + 1000 - LAG - INTERP_DELAY_MS)
  })
})

describe('poseAt', () => {
  it('is null with no samples and holds the only sample', () => {
    expect(poseAt([], 0)).toBeNull()
    expect(poseAt(track(1), 99_999)).toEqual({ x: 0, y: 0, heading: 0 })
  })
  it('blends linearly between the samples around the render time', () => {
    const t = track(4)
    expect(poseAt(t, browserAt(SKEW + 250))!.x).toBeCloseTo(0.5)
    expect(poseAt(t, browserAt(SKEW + 1100))!.x).toBeCloseTo(2.2)
  })
  it('moves a little every frame instead of jumping every sample', () => {
    const t = track(6)
    const xs = Array.from({ length: 30 }, (_, f) => poseAt(t, browserAt(SKEW + 500) + f * 16)!.x)
    for (let i = 1; i < xs.length; i++) {
      const step = xs[i] - xs[i - 1]
      expect(step).toBeGreaterThan(0)
      expect(step).toBeLessThan(0.05) // 1 m per 500 ms is 0.032 m per 16 ms frame
    }
  })
  it('holds at the newest sample instead of guessing ahead', () => {
    const t = track(3)
    expect(poseAt(t, browserAt(SKEW + 60_000))).toEqual({ x: 2, y: 0, heading: 0 })
  })
  it('turns the short way round', () => {
    let t: Track = []
    t = addSample(t, { ts: SKEW, x: 0, y: 0, heading: 3.0 }, LAG)
    t = addSample(t, { ts: SKEW + 500, x: 0, y: 0, heading: -3.0 }, 500 + LAG)
    const h = poseAt(t, browserAt(SKEW + 250))!.heading
    expect(Math.abs(h)).toBeGreaterThan(3.0) // through pi, not through 0
  })
  it('waits at the old pose across an outage, then shows the new one', () => {
    let t = track(2)
    const after = SKEW + 500 + MAX_GAP_MS + 1000
    t = addSample(t, { ts: after, x: 3, y: 0, heading: 0 }, after - SKEW + LAG)
    expect(poseAt(t, browserAt(after - 100))!.x).toBe(1)
    expect(poseAt(t, browserAt(after))!.x).toBe(3)
  })
})
