import type { ModelConfig } from './robotModel'

// Auto-normalize a model of unknown units: scale its larger horizontal extent to a target
// footprint, centre it on x/z, and sit its lowest point on the ground. Plain numbers in and out.

export const TARGET_FOOTPRINT_M = 2

export interface Bounds {
  min: [number, number, number]
  max: [number, number, number]
}

export interface Fit {
  scale: number
  offset: [number, number, number] // applied after scaling (in parent units)
  yaw: number
}

export function fitScale(bounds: Bounds, target = TARGET_FOOTPRINT_M): number {
  const sx = bounds.max[0] - bounds.min[0]
  const sz = bounds.max[2] - bounds.min[2]
  const extent = Math.max(sx, sz)
  // Uses x/z only so the fit doesn't depend on which way the model faces.
  if (!Number.isFinite(extent) || extent <= 0) return 1
  return target / extent
}

export function fitTransform(bounds: Bounds, cfg: Pick<ModelConfig, 'scale' | 'yawOffset' | 'groundOffset'>): Fit {
  const scale = fitScale(bounds) * cfg.scale
  const cx = (bounds.min[0] + bounds.max[0]) / 2
  const cz = (bounds.min[2] + bounds.max[2]) / 2
  const minY = Number.isFinite(bounds.min[1]) ? bounds.min[1] : 0
  return {
    scale,
    offset: [-cx * scale || 0, -minY * scale + cfg.groundOffset, -cz * scale || 0],
    yaw: cfg.yawOffset,
  }
}
