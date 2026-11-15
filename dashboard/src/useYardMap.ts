import { useEffect, useState } from 'react'
import { MapError } from './map/errors'
import { loadMap, themeMapColors, type MapSource } from './map/loadMap'
import { toRgba, toRgbaTopFirst } from './map/occupancy'
import { STAND_IN_YARD, yardFromMap, type YardState } from './yard'

// Loads the yard map once at startup (decisions log: Map loader). While it loads, and if it fails, the
// yard is the stand-in; a failure is reported in `error` for the banner.
export const DEFAULT_MAP: MapSource = { yaml: '/maps/yard.yaml' }

async function pngUrl(rgba: Uint8ClampedArray<ArrayBuffer>, width: number, height: number): Promise<string> {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d')!.putImageData(new ImageData(rgba, width, height), 0, 0)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new MapError('Could not draw the map image.')
  return URL.createObjectURL(blob)
}

export function useYardMap(source: MapSource = DEFAULT_MAP): YardState {
  const [state, setState] = useState<YardState>({ config: STAND_IN_YARD, map: null, image: null, error: null })

  useEffect(() => {
    let cancelled = false
    let url: string | null = null
    ;(async () => {
      try {
        const map = await loadMap(source)
        for (const w of map.warnings) console.warn(w)
        const colors = themeMapColors()
        const { width, height } = map.grid
        url = await pngUrl(toRgbaTopFirst(map.grid, colors) as Uint8ClampedArray<ArrayBuffer>, width, height)
        if (cancelled) return URL.revokeObjectURL(url)
        setState({ config: yardFromMap(map), map, image: { width, height, rgba: toRgba(map.grid, colors), url }, error: null })
      } catch (err) {
        if (cancelled) return
        const message = err instanceof MapError ? err.message : `Unexpected error: ${(err as Error).message}`
        console.error('[map] load failed:', err)
        setState({ config: STAND_IN_YARD, map: null, image: null, error: message })
      }
    })()
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [source])

  return state
}
