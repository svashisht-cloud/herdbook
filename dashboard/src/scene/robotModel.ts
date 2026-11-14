// Robot model config (decisions log: Robot model). The viewer takes a ModelConfig and doesn't care
// where the URL came from; uploaded models will use the same shape. The file itself is in
// public/models/ (served, not bundled), so this config lives here in src/.

export interface ModelConfig {
  url: string
  scale: number // multiplier on top of the auto-fit to TARGET_FOOTPRINT_M
  yawOffset: number // radians about +Y so the model's front faces ROS +x
  groundOffset: number // metres added after the model's lowest point is put on the ground
}

export const MODEL_DEFAULTS: Omit<ModelConfig, 'url'> = { scale: 1, yawOffset: 0, groundOffset: 0 }

export function modelConfig(partial: Partial<ModelConfig> & { url: string }): ModelConfig {
  return { ...MODEL_DEFAULTS, ...partial }
}

// robot1.glb is a 6-wheel rover whose front faces +Z (the glTF convention): its axles run along Z
// and its mast sits forward of centre. Rotating +Z onto +X (ROS forward at yaw 0) takes +pi/2.
export const ROBOT_MODEL: ModelConfig = modelConfig({ url: '/models/robot1.glb', yawOffset: Math.PI / 2 })
