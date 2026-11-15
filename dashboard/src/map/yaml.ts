import { MapError } from './errors'

// A minimal parser for map_server YAML (decisions log: Map YAML parser). These files are flat: scalar
// keys plus a 3-number origin list. Supported: `key: value` (numbers, bare or quoted strings), # comments,
// and lists as flow `[a, b, c]` or block (`- a` lines). Anything else fails with its line number.

export interface MapYaml {
  image: string
  resolution: number
  origin: [number, number] // metres; yaw is ignored (see warnings)
  negate: boolean
  occupiedThresh: number
  freeThresh: number
  warnings: string[]
}

type Value = string | number | (string | number)[]

function stripComment(line: string): string {
  let quote: string | null = null
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quote) {
      if (c === quote) quote = null
    } else if (c === '"' || c === "'") quote = c
    else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i)
  }
  return line
}

function scalar(raw: string, lineNo: number): string | number {
  const s = raw.trim()
  if (/^"(.*)"$/.test(s) || /^'(.*)'$/.test(s)) return s.slice(1, -1)
  if (/[[\]{}&*!|>]/.test(s[0] ?? '')) throw new MapError(`Unsupported YAML at line ${lineNo}: "${s}".`)
  const n = Number(s)
  return s !== '' && Number.isFinite(n) ? n : s
}

/** Flat key -> value parse of the subset above. */
export function parseFlatYaml(text: string): Record<string, Value> {
  const out: Record<string, Value> = {}
  let listKey: string | null = null
  text.split(/\r?\n/).forEach((rawLine, idx) => {
    const lineNo = idx + 1
    const line = stripComment(rawLine)
    if (!line.trim()) return
    const item = /^\s+-\s*(.*)$/.exec(line) ?? /^-\s+(.*)$/.exec(line)
    if (item) {
      if (!listKey) throw new MapError(`Unsupported YAML at line ${lineNo}: a list item without a key.`)
      ;(out[listKey] as (string | number)[]).push(scalar(item[1], lineNo))
      return
    }
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line)
    if (!kv || /^\s/.test(line)) throw new MapError(`Unsupported YAML at line ${lineNo}: "${rawLine.trim()}".`)
    const [, key, rest] = kv
    const value = rest.trim()
    listKey = null
    if (value === '') {
      out[key] = []
      listKey = key // a block list may follow
    } else if (value.startsWith('[')) {
      if (!value.endsWith(']')) throw new MapError(`Unsupported YAML at line ${lineNo}: a list must close on the same line.`)
      const inner = value.slice(1, -1).trim()
      out[key] = inner === '' ? [] : inner.split(',').map((p) => scalar(p, lineNo))
    } else out[key] = scalar(value, lineNo)
  })
  return out
}

function num(v: Value | undefined, key: string): number {
  if (typeof v !== 'number') throw new MapError(`Map YAML: "${key}" must be a number${v === undefined ? ', and it is missing' : ''}.`)
  return v
}

export function parseMapYaml(text: string): MapYaml {
  const y = parseFlatYaml(text)
  const warnings: string[] = []
  if (typeof y.image !== 'string' || y.image === '') throw new MapError('Map YAML: "image" (the PGM file name) is missing.')
  const resolution = num(y.resolution, 'resolution')
  if (!(resolution > 0)) throw new MapError(`Map YAML: "resolution" must be a positive number of metres per pixel, not ${resolution}.`)
  const origin = y.origin
  if (!Array.isArray(origin) || origin.length < 2 || origin.length > 3 || origin.some((o) => typeof o !== 'number')) {
    throw new MapError('Map YAML: "origin" must be a list of 2 or 3 numbers: [x, y, yaw].')
  }
  const [ox, oy, yaw = 0] = origin as number[]
  if (yaw !== 0) warnings.push(`Map YAML: origin yaw ${yaw} rad is not supported and was ignored; the map is drawn unrotated.`)
  const negate = y.negate === undefined ? 0 : num(y.negate, 'negate')
  if (negate !== 0 && negate !== 1) throw new MapError(`Map YAML: "negate" must be 0 or 1, not ${negate}.`)
  const occupiedThresh = num(y.occupied_thresh, 'occupied_thresh')
  const freeThresh = num(y.free_thresh, 'free_thresh')
  for (const [k, v] of [['occupied_thresh', occupiedThresh], ['free_thresh', freeThresh]] as const) {
    if (v < 0 || v > 1) throw new MapError(`Map YAML: "${k}" must be between 0 and 1, not ${v}.`)
  }
  if (freeThresh >= occupiedThresh) {
    throw new MapError(`Map YAML: "free_thresh" (${freeThresh}) must be below "occupied_thresh" (${occupiedThresh}).`)
  }
  return { image: y.image, resolution, origin: [ox, oy], negate: negate === 1, occupiedThresh, freeThresh, warnings }
}
