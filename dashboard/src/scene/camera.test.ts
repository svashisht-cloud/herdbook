import { describe, expect, it } from 'vitest'
import { FOLLOW_DISTANCE_M, followView, homeView, stepCamera, type CameraState } from './camera'
import type { Vec3 } from './transform'

const home = homeView([50, 0, -30], 100)
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
const run = (s: CameraState, focus: Vec3 | null, frames: number) => {
  for (let i = 0; i < frames; i++) s = stepCamera(s, focus, home, 1 / 60)
  return s
}

describe('homeView', () => {
  it('looks at the yard centre from above and south of it', () => {
    expect(home.target).toEqual([50, 0, -30])
    expect(home.position[1]).toBeGreaterThan(0)
    expect(home.position[2]).toBeGreaterThan(-30)
  })
})

describe('followView', () => {
  it('keeps the viewing direction and sits FOLLOW_DISTANCE_M from the focus', () => {
    const v = followView(home, [10, 0, -10])
    expect(v.target).toEqual([10, 0, -10])
    expect(dist(v.position, v.target)).toBeCloseTo(FOLLOW_DISTANCE_M)
    const before = [home.position[0] - home.target[0], home.position[1] - home.target[1], home.position[2] - home.target[2]]
    const after = [v.position[0] - 10, v.position[1], v.position[2] + 10]
    const cos = (before[0] * after[0] + before[1] * after[1] + before[2] * after[2]) / (Math.hypot(...before) * Math.hypot(...after))
    expect(cos).toBeCloseTo(1)
  })
  it('has a fallback direction when camera and target coincide', () => {
    const v = followView({ position: [1, 1, 1], target: [1, 1, 1] }, [0, 0, 0])
    expect(dist(v.position, [0, 0, 0])).toBeCloseTo(FOLLOW_DISTANCE_M)
  })
})

describe('stepCamera', () => {
  const start: CameraState = { ...home, phase: 'free' }

  it('leaves the camera alone when free and nothing is selected', () => {
    expect(stepCamera(start, null, home, 1 / 60)).toBe(start)
  })
  it('zooms in on a selection, then follows', () => {
    const focus: Vec3 = [20, 0.6, -10]
    const first = stepCamera(start, focus, home, 1 / 60)
    expect(first.phase).toBe('zoomIn')
    const s = run(start, focus, 180)
    expect(s.phase).toBe('follow')
    expect(dist(s.target, focus)).toBeLessThan(0.1)
    expect(dist(s.position, s.target)).toBeCloseTo(FOLLOW_DISTANCE_M, 0)
  })
  it('in follow, moves the camera with the target and keeps the user offset', () => {
    const s: CameraState = { position: [0, 5, 7], target: [0, 0, 0], phase: 'follow' }
    const n = stepCamera(s, [4, 0, 0], home, 1 / 60)
    const offsetBefore = [0, 5, 7]
    const offsetAfter = [n.position[0] - n.target[0], n.position[1] - n.target[1], n.position[2] - n.target[2]]
    offsetAfter.forEach((v, i) => expect(v).toBeCloseTo(offsetBefore[i]))
    expect(n.target[0]).toBeGreaterThan(0)
    expect(n.phase).toBe('follow')
  })
  it('keeps up with a moving robot', () => {
    let s = run(start, [20, 0.6, -10], 180)
    let x = 20
    for (let i = 0; i < 300; i++) {
      x += 1.5 / 60 // 1.5 m/s
      s = stepCamera(s, [x, 0.6, -10], home, 1 / 60)
    }
    expect(s.phase).toBe('follow')
    expect(Math.abs(s.target[0] - x)).toBeLessThan(1)
  })
  it('returns home on deselect, then hands the camera back', () => {
    const following = run(start, [20, 0.6, -10], 180)
    const back = stepCamera(following, null, home, 1 / 60)
    expect(back.phase).toBe('home')
    const done = run(following, null, 300)
    expect(done.phase).toBe('free')
    expect(dist(done.target, home.target)).toBeLessThan(1)
  })
})
