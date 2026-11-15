import { MapError } from './errors'

// PGM grayscale images (decisions log: Map loader). P5 (binary) and P2 (text), 8-bit (maxval <= 255).
// Data stays in file order: row 0 is the TOP of the image. occupancy.ts flips it into the map frame.

export const MAX_SIDE_PX = 8192
export const MAX_PIXELS = 16 * 1024 * 1024

export interface Pgm {
  width: number
  height: number
  maxval: number
  data: Uint8Array // width * height values scaled to 0..255, top row first
}

const isSpace = (b: number) => b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d || b === 0x0b || b === 0x0c

/** Reads header tokens, skipping whitespace and # comments. Returns the tokens and the offset after the last one. */
function headerTokens(bytes: Uint8Array, count: number): { tokens: string[]; end: number } {
  const tokens: string[] = []
  let i = 0
  while (tokens.length < count) {
    while (i < bytes.length && isSpace(bytes[i])) i++
    if (i >= bytes.length) throw new MapError('Malformed PGM header: the file ends before the header is complete.')
    if (bytes[i] === 0x23) {
      while (i < bytes.length && bytes[i] !== 0x0a && bytes[i] !== 0x0d) i++
      continue
    }
    const start = i
    while (i < bytes.length && !isSpace(bytes[i]) && bytes[i] !== 0x23) i++
    tokens.push(new TextDecoder().decode(bytes.subarray(start, i)))
  }
  return { tokens, end: i }
}

function positiveInt(token: string, what: string): number {
  if (!/^\d+$/.test(token)) throw new MapError(`Malformed PGM header: ${what} is "${token}", not a whole number.`)
  return Number(token)
}

export function parsePgm(bytes: Uint8Array): Pgm {
  if (bytes.length < 2) throw new MapError('Malformed PGM header: the file is empty.')
  const magic = String.fromCharCode(bytes[0], bytes[1])
  if (magic !== 'P5' && magic !== 'P2') {
    const shown = /^[\x20-\x7e]{2}$/.test(magic) ? `'${magic}'` : 'unknown'
    throw new MapError(`Unsupported image format ${shown}: only P5 (binary) or P2 (text) grayscale PGM.`)
  }
  const { tokens, end } = headerTokens(bytes, 4)
  const width = positiveInt(tokens[1], 'width')
  const height = positiveInt(tokens[2], 'height')
  const maxval = positiveInt(tokens[3], 'maxval')
  if (width === 0 || height === 0) throw new MapError(`Malformed PGM header: the image is ${width} × ${height} px.`)
  if (maxval < 1 || maxval > 255) throw new MapError(`Unsupported PGM maxval ${maxval}: only 8-bit images (maxval 1–255).`)
  if (width > MAX_SIDE_PX || height > MAX_SIDE_PX || width * height > MAX_PIXELS) {
    throw new MapError(`Map is too large: ${width} × ${height} px (limit ${MAX_SIDE_PX} px per side and 16 M pixels).`)
  }
  const n = width * height
  const scale = maxval === 255 ? null : 255 / maxval
  const data = new Uint8Array(n)

  if (magic === 'P5') {
    const start = end + 1 // exactly one whitespace byte separates maxval from the data
    const raw = bytes.subarray(start)
    if (raw.length < n) throw new MapError(`Image data is shorter than the header says: expected ${n} bytes, got ${raw.length}.`)
    if (raw.length > n) throw new MapError(`Image data is longer than the header says: expected ${n} bytes, got ${raw.length}.`)
    for (let k = 0; k < n; k++) {
      const v = raw[k]
      if (v > maxval) throw new MapError(`Pixel ${k} is ${v}, above the header's maxval ${maxval}.`)
      data[k] = scale ? Math.round(v * scale) : v
    }
  } else {
    const text = new TextDecoder().decode(bytes.subarray(end)).replace(/#[^\n\r]*/g, ' ')
    const values = text.split(/\s+/).filter(Boolean)
    if (values.length !== n) {
      throw new MapError(`Image data has ${values.length} values, but the header says ${width} × ${height} = ${n}.`)
    }
    for (let k = 0; k < n; k++) {
      const v = Number(values[k])
      if (!Number.isInteger(v) || v < 0 || v > maxval) throw new MapError(`Pixel ${k} is "${values[k]}", not a value from 0 to ${maxval}.`)
      data[k] = scale ? Math.round(v * scale) : v
    }
  }
  return { width, height, maxval, data }
}
