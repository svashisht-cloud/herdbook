import { SNAP_DISTANCE_M, wrapAngle } from './smoothing'

// Pose interpolation (decisions log: Pose interpolation). Telemetry arrives at 2 Hz, so both views draw
// each robot INTERP_DELAY_MS in the past, blending between the two real samples around that moment.
// There is almost always a newer sample than the moment drawn, so motion is continuous and follows the
// real path (stops and turns in place included); nothing is extrapolated.
//
// Times: samples carry the robot's ts. The render time is mapped onto that clock with the smallest
// recent (arrival - ts): the least-delayed sample is the best estimate of the clock offset, so robot
// clock skew and network jitter don't matter. Pure functions; the caller keeps tracks in a ref.

export const INTERP_DELAY_MS = 600 // a little over one telemetry period
export const MAX_SAMPLES = 20 // ~10 s at 2 Hz: the window the clock offset is taken over
export const MAX_GAP_MS = 2000 // samples further apart than this aren't blended (an outage, not motion)

export interface Sample {
  ts: number // robot clock, UTC ms
  x: number // ROS metres
  y: number
  heading: number // radians, ROS yaw
  lag: number // arrival (browser ms) - ts
}

export interface Pose {
  x: number
  y: number
  heading: number
}

export type Track = readonly Sample[]

/** Append a live sample. Older or repeated ts are ignored; a jump over SNAP_DISTANCE_M starts over. */
export function addSample(track: Track, s: Pose & { ts: number }, arrival: number): Track {
  const last = track[track.length - 1]
  if (last && s.ts <= last.ts) return track
  const sample: Sample = { ts: s.ts, x: s.x, y: s.y, heading: s.heading, lag: arrival - s.ts }
  if (last && Math.hypot(s.x - last.x, s.y - last.y) > SNAP_DISTANCE_M) return [sample]
  const next = [...track, sample]
  return next.length > MAX_SAMPLES ? next.slice(next.length - MAX_SAMPLES) : next
}

/** The robot-clock time to draw at browser time `now`. */
export function renderTs(track: Track, now: number, delay = INTERP_DELAY_MS): number {
  let lag = Infinity
  for (const s of track) lag = Math.min(lag, s.lag)
  return now - lag - delay
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k

/** Where to draw the robot at browser time `now`, or null for an empty track. Holds at the ends. */
export function poseAt(track: Track, now: number, delay = INTERP_DELAY_MS): Pose | null {
  if (track.length === 0) return null
  const t = renderTs(track, now, delay)
  const first = track[0]
  const last = track[track.length - 1]
  if (t <= first.ts) return { x: first.x, y: first.y, heading: first.heading }
  if (t >= last.ts) return { x: last.x, y: last.y, heading: last.heading }
  let i = track.length - 2
  while (i > 0 && track[i].ts > t) i--
  const a = track[i]
  const b = track[i + 1]
  // Across an outage, wait at the old pose and then appear at the new one, rather than gliding.
  if (b.ts - a.ts > MAX_GAP_MS) return { x: a.x, y: a.y, heading: a.heading }
  const k = (t - a.ts) / (b.ts - a.ts)
  return {
    x: lerp(a.x, b.x, k),
    y: lerp(a.y, b.y, k),
    heading: wrapAngle(a.heading + wrapAngle(b.heading - a.heading) * k),
  }
}
