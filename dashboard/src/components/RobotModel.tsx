import { useGLTF } from '@react-three/drei'
import { useEffect, useMemo } from 'react'
import { Box3, Mesh, type Material, type Object3D } from 'three'
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { fitTransform } from '../scene/modelFit'
import type { ModelConfig } from '../scene/robotModel'

// useDraco=false: never fetch a decoder from a third-party CDN (drei defaults to gstatic.com).
const USE_DRACO = false

export function preloadRobotModel(cfg: ModelConfig) {
  useGLTF.preload(cfg.url, USE_DRACO)
}

/** One robot's copy of the model, with its own geometry and materials, fitted by fitTransform. */
export function RobotModel({ cfg }: { cfg: ModelConfig }) {
  const { scene } = useGLTF(cfg.url, USE_DRACO)

  const { object, fit } = useMemo(() => {
    let skinned = false
    scene.traverse((o) => {
      if ((o as Mesh & { isSkinnedMesh?: boolean }).isSkinnedMesh) skinned = true
    })
    const object: Object3D = skinned ? skeletonClone(scene) : scene.clone(true)
    object.traverse((o) => {
      if (o instanceof Mesh) {
        o.geometry = o.geometry.clone()
        o.material = Array.isArray(o.material) ? o.material.map((m: Material) => m.clone()) : o.material.clone()
      }
    })
    const b = new Box3().setFromObject(object)
    const fit = fitTransform({ min: b.min.toArray(), max: b.max.toArray() }, cfg)
    return { object, fit }
  }, [scene, cfg])

  // Dispose only what this robot owns; textures stay shared with the cached GLTF.
  useEffect(
    () => () => {
      object.traverse((o) => {
        if (o instanceof Mesh) {
          o.geometry.dispose()
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose()
        }
      })
    },
    [object],
  )

  return (
    <group rotation-y={fit.yaw}>
      <group position={fit.offset} scale={fit.scale}>
        <primitive object={object} />
      </group>
    </group>
  )
}
