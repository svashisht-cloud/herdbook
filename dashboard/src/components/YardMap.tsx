import { STATUS_COLOR } from '../status'
import type { Robot } from '../types'

// Fixed floor bounds in metres (decisions log). ROS y points up, SVG y points down, so y is flipped.
const W = 100
const H = 60
const GRID = 10
const DOT_R = 1.6
const HEADING_LEN = 3.6

interface Props {
  robots: Robot[]
  selected: string | null
  onSelect: (id: string) => void
}

export function YardMap({ robots, selected, onSelect }: Props) {
  const xs = Array.from({ length: W / GRID + 1 }, (_, i) => i * GRID)
  const ys = Array.from({ length: H / GRID + 1 }, (_, i) => i * GRID)
  return (
    <svg className="yard" viewBox={`-2 -2 ${W + 4} ${H + 4}`} role="img" aria-label="Floor map">
      <g className="grid">
        {xs.map((x) => (
          <line key={`x${x}`} x1={x} y1={0} x2={x} y2={H} />
        ))}
        {ys.map((y) => (
          <line key={`y${y}`} x1={0} y1={y} x2={W} y2={y} />
        ))}
      </g>
      <rect className="border" x={0} y={0} width={W} height={H} />
      {robots.map((r) => {
        const s = r.last_state
        if (!s) return null
        const hx = Math.cos(s.heading) * HEADING_LEN
        const hy = -Math.sin(s.heading) * HEADING_LEN
        const color = STATUS_COLOR[r.status]
        return (
          <g
            key={r.robot_id}
            className="robot"
            transform={`translate(${s.x} ${H - s.y})`}
            onClick={() => onSelect(r.robot_id)}
          >
            {r.robot_id === selected && <circle r={DOT_R + 1} className="halo" />}
            <line x1={0} y1={0} x2={hx} y2={hy} stroke={color} strokeWidth={0.6} strokeLinecap="round" />
            <circle r={DOT_R} fill={color} />
            <text y={-DOT_R - 1}>{r.robot_id}</text>
          </g>
        )
      })}
    </svg>
  )
}
