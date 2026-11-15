import { describe, expect, it } from 'vitest'
import { MODEL_DEFAULTS, ROBOT_MODEL, modelConfig } from './robotModel'

describe('modelConfig', () => {
  it('fills defaults', () => {
    expect(modelConfig({ url: '/m.glb' })).toEqual({ url: '/m.glb', scale: 1, yawOffset: 0, groundOffset: 0 })
  })
  it('keeps explicit values', () => {
    const c = modelConfig({ url: '/m.glb', scale: 2, yawOffset: Math.PI, groundOffset: 0.1 })
    expect(c).toEqual({ url: '/m.glb', scale: 2, yawOffset: Math.PI, groundOffset: 0.1 })
  })
  it('does not mutate the defaults', () => {
    modelConfig({ url: '/m.glb', scale: 5 })
    expect(MODEL_DEFAULTS.scale).toBe(1)
  })
  it('the robot model is a complete config served from public/models', () => {
    expect(ROBOT_MODEL.url).toMatch(/^\/models\/.+\.glb$/)
    for (const k of ['scale', 'yawOffset', 'groundOffset'] as const) expect(Number.isFinite(ROBOT_MODEL[k])).toBe(true)
  })
})
