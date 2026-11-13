import { useEffect, useRef, type RefObject } from 'react'
import { addPoint, type TrailPoint } from './scene/trail'
import type { Robot, Telemetry } from './types'

export type Trails = RefObject<Map<string, TrailPoint[]>>

/**
 * Per-robot trail buffers, fed from the existing telemetry listener (decisions log: Trails).
 * The map lives in a ref, not React state, so trails never cause re-renders; the 2D map reads it
 * when it re-renders on telemetry, and the 3D view reads it in useFrame.
 */
export function useTrails(subscribeTelemetry: (fn: (t: Telemetry) => void) => () => void, robots: Robot[]): Trails {
  const trails = useRef(new Map<string, TrailPoint[]>())

  useEffect(
    () =>
      subscribeTelemetry((t) => {
        const map = trails.current
        map.set(t.robot_id, addPoint(map.get(t.robot_id) ?? [], t, Date.now()))
      }),
    [subscribeTelemetry],
  )

  // Seed each robot's trail with its last known position from GET /robots, once.
  useEffect(() => {
    const map = trails.current
    for (const r of robots) {
      if (r.last_state && !map.get(r.robot_id)?.length) map.set(r.robot_id, addPoint([], r.last_state, Date.now()))
    }
  }, [robots])

  return trails
}
