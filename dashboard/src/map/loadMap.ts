import { THEME, hexToRgb } from '../theme'
import { MapError } from './errors'
import { toMapGrid, type MapColors, type MapGrid } from './occupancy'
import { parsePgm } from './pgm'
import { parseMapYaml, type MapYaml } from './yaml'

// Loads a ROS map_server map (YAML + PGM) from any source (decisions log: Map loader). A string is a URL
// to fetch; a Blob (or File) is read directly. Today the default map is a static URL; uploads and
// server-stored maps will pass Blobs or other URLs through this same function.

export type MapFileSource = string | Blob

export interface MapSource {
  yaml: MapFileSource
  /** The PGM. Optional for a URL yaml: then the yaml's `image:` is resolved relative to the yaml's URL. */
  image?: MapFileSource
}

export interface LoadedMap {
  meta: MapYaml
  grid: MapGrid
  widthM: number
  heightM: number
  origin: [number, number]
  warnings: string[]
}

const label = (src: MapFileSource) => (typeof src === 'string' ? src : src instanceof File ? src.name : 'uploaded file')

async function readBytes(src: MapFileSource): Promise<Uint8Array> {
  if (typeof src !== 'string') return new Uint8Array(await src.arrayBuffer())
  let res: Response
  try {
    res = await fetch(src)
  } catch {
    throw new MapError(`Map file not found: ${src} (network error).`)
  }
  if (!res.ok) throw new MapError(`Map file not found: ${src} (HTTP ${res.status}).`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  // Dev servers and SPA hosts answer a missing file with index.html and status 200.
  const type = res.headers.get('content-type') ?? ''
  const head = new TextDecoder().decode(bytes.subarray(0, 64)).trimStart().toLowerCase()
  if (type.includes('text/html') || head.startsWith('<!doctype') || head.startsWith('<html')) {
    throw new MapError(`Map file not found: ${src}.`)
  }
  return bytes
}

/** The image path in a URL yaml, resolved against the yaml's own URL. */
export function resolveImage(yamlUrl: string, image: string): string {
  const base = new URL(yamlUrl, 'http://local.invalid/')
  const url = new URL(image, base)
  return url.origin === 'http://local.invalid' ? url.pathname + url.search : url.href
}

export async function loadMap(source: MapSource): Promise<LoadedMap> {
  const yamlBytes = await readBytes(source.yaml)
  const meta = parseMapYaml(new TextDecoder().decode(yamlBytes))
  let image = source.image
  if (!image) {
    if (typeof source.yaml !== 'string') throw new MapError('Map YAML was given without its PGM image.')
    image = resolveImage(source.yaml, meta.image)
  }
  let pgm
  try {
    pgm = parsePgm(await readBytes(image))
  } catch (err) {
    if (err instanceof MapError && !err.message.startsWith('Map file not found')) {
      throw new MapError(`${label(image)}: ${err.message}`)
    }
    throw err
  }
  const grid = toMapGrid(pgm, meta)
  return {
    meta,
    grid,
    widthM: grid.width * meta.resolution,
    heightM: grid.height * meta.resolution,
    origin: meta.origin,
    warnings: meta.warnings,
  }
}

const rgba = (hex: string): [number, number, number, number] => [...hexToRgb(hex), 255]

/** Occupancy colors from the theme (no hex here). */
export function themeMapColors(): MapColors {
  return { free: rgba(THEME.color.mapFree), occupied: rgba(THEME.color.mapOccupied), unknown: rgba(THEME.color.mapUnknown) }
}
