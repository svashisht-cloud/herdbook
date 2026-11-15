import type { Pgm } from './pgm'
import type { MapYaml } from './yaml'

// Occupancy grid in the MAP FRAME (decisions log: Map loader). PGM row 0 is the top of the image, but
// the map frame's origin is the bottom-left, so this is the one place the rows are flipped: cell (i, j)
// is at origin + (i, j) * resolution, with j = 0 the bottom row.

export const FREE = 0
export const OCCUPIED = 1
export const UNKNOWN = 2
export type Cell = typeof FREE | typeof OCCUPIED | typeof UNKNOWN

export interface MapGrid {
  width: number // cells
  height: number
  resolution: number // metres per cell
  origin: [number, number] // map-frame metres of cell (0, 0)'s corner
  cells: Uint8Array // width * height, bottom row first
}

/** map_server trinary mode: occupancy probability from the pixel, then the two thresholds. */
export function classify(value: number, meta: Pick<MapYaml, 'negate' | 'occupiedThresh' | 'freeThresh'>): Cell {
  const p = meta.negate ? value / 255 : (255 - value) / 255
  if (p > meta.occupiedThresh) return OCCUPIED
  if (p < meta.freeThresh) return FREE
  return UNKNOWN
}

export function toMapGrid(pgm: Pgm, meta: MapYaml): MapGrid {
  const { width, height } = pgm
  const cells = new Uint8Array(width * height)
  for (let row = 0; row < height; row++) {
    const j = height - 1 - row // the flip: image top row -> map-frame top (highest j)
    for (let i = 0; i < width; i++) cells[j * width + i] = classify(pgm.data[row * width + i], meta)
  }
  return { width, height, resolution: meta.resolution, origin: meta.origin, cells }
}

export const cellAt = (g: MapGrid, i: number, j: number): Cell => g.cells[j * g.width + i] as Cell

/** Map-frame metres -> cell, or null outside the map. */
export function worldToCell(g: MapGrid, x: number, y: number): [number, number] | null {
  const i = Math.floor((x - g.origin[0]) / g.resolution)
  const j = Math.floor((y - g.origin[1]) / g.resolution)
  return i < 0 || j < 0 || i >= g.width || j >= g.height ? null : [i, j]
}

export type Rgba = [number, number, number, number]
export interface MapColors {
  free: Rgba
  occupied: Rgba
  unknown: Rgba
}

function paint(g: MapGrid, colors: MapColors, topFirst: boolean): Uint8ClampedArray {
  const out = new Uint8ClampedArray(g.width * g.height * 4)
  const lut = [colors.free, colors.occupied, colors.unknown]
  for (let j = 0; j < g.height; j++) {
    const row = topFirst ? g.height - 1 - j : j
    for (let i = 0; i < g.width; i++) {
      const c = lut[g.cells[j * g.width + i]]
      out.set(c, (row * g.width + i) * 4)
    }
  }
  return out
}

/** RGBA, bottom row first: the order of a three.js DataTexture (v = 0 at the bottom). */
export const toRgba = (g: MapGrid, colors: MapColors) => paint(g, colors, false)
/** RGBA, top row first: the order of a canvas ImageData, for the 2D map's image. */
export const toRgbaTopFirst = (g: MapGrid, colors: MapColors) => paint(g, colors, true)
