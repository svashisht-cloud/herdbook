import { createContext, useContext } from 'react'
import type { LoadedMap } from './map/loadMap'

// The one place that exposes yard geometry (decisions log: Yard bounds). It's derived at runtime from
// the loaded occupancy map (decisions log: Map loader), with STAND_IN_YARD as the fallback while the
// map loads or if it fails. Both views read it through useYard(); decor, labels, cameras and trails
// all take the YardConfig, so they resize with the map. Units: metres, ROS map frame; origin is the
// yard's bottom-left corner.

export interface YardConfig {
  width: number
  height: number
  origin: { x: number; y: number }
  grid: number // grid line spacing
}

export const STAND_IN_YARD: YardConfig = {
  width: 100,
  height: 60,
  origin: { x: 0, y: 0 },
  grid: 10,
}

/** A 1/2/5 x 10^n step giving about `cells` grid cells across `extent` metres (10 m for 100 m). */
export function niceGridStep(extent: number, cells = 10): number {
  if (!(extent > 0)) return 1
  const raw = extent / cells
  const p = 10 ** Math.floor(Math.log10(raw))
  const m = raw / p
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p
}

/** Yard geometry from a loaded map: size = pixels * resolution, bounds start at the map origin. */
export function yardFromMap(map: Pick<LoadedMap, 'widthM' | 'heightM' | 'origin'>): YardConfig {
  return {
    width: map.widthM,
    height: map.heightM,
    origin: { x: map.origin[0], y: map.origin[1] },
    grid: niceGridStep(Math.max(map.widthM, map.heightM)),
  }
}

/** Grid line offsets from the origin along one axis, 0..length inclusive. */
export function gridLines(length: number, step: number): number[] {
  const n = Math.floor(length / step + 1e-9)
  return Array.from({ length: n + 1 }, (_, i) => i * step)
}

/** The map drawn on the floor, in the two pixel orders the views need. */
export interface YardImage {
  width: number // px
  height: number
  rgba: Uint8ClampedArray // bottom row first: three.js DataTexture order (3D floor)
  url: string // PNG object URL, top row first: image order (2D map)
}

export interface YardState {
  config: YardConfig
  map: LoadedMap | null // null: still loading, or failed (see error)
  image: YardImage | null
  error: string | null
}

export const YardContext = createContext<YardState>({ config: STAND_IN_YARD, map: null, image: null, error: null })

export const useYard = (): YardState => useContext(YardContext)
