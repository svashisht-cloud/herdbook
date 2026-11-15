import { useEffect, useRef, type RefObject } from 'react'
import { addSample, type Track } from './scene/interpolate'
import type { Robot, Telemetry } from './types'

export type Tracks = RefObject<Map<string, Track>>

/**
 * Per-robot sample buffers for pose interpolation (decisions log: Pose interpolation), fed from the live
 * telemetry listener, which only carries telemetry that advanced a robot's state (never backfill). Held
 * in a ref like the trails: both views read it every frame without React renders.
 */
export function useTracks(subscribeTelemetry: (fn: (t: Telemetry) => void) => () => void, robots: Robot[]): Tracks {
  const tracks = useRef(new Map<string, Track>())

  useEffect(
    () =>
      subscribeTelemetry((t) => {
        const map = tracks.current
        map.set(t.robot_id, addSample(map.get(t.robot_id) ?? [], t, Date.now()))
      }),
    [subscribeTelemetry],
  )

  // Seed each robot with its last known pose from GET /robots, once, so it's drawn before live data.
  useEffect(() => {
    const map = tracks.current
    for (const r of robots) {
      if (r.last_state && !map.get(r.robot_id)?.length) map.set(r.robot_id, addSample([], r.last_state, Date.now()))
    }
  }, [robots])

  return tracks
}
