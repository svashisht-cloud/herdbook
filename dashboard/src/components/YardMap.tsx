import { robotGlyph, svgRotation } from '../scene/glyph'
import { axes, edgeLabels, labelLayout, mapFrame, scaleHint } from '../scene/yardDecor'
import { segments } from '../scene/trail'
import { statusColor } from '../status'
import type { Robot } from '../types'
import type { Trails } from '../useTrails'
import { YARD, gridLines } from '../yard'

// Everything here derives from YARD (decisions log). ROS y points up and SVG y points down, so y is flipped.
const W = YARD.width
const H = YARD.height
const FRAME = mapFrame(YARD) // the same box the 3D canvas frames, so the two views line up
const L = labelLayout(YARD)
const FONT = L.font
const GLYPH = robotGlyph()
const HALO_R = Math.hypot(GLYPH.body.w, GLYPH.body.h) / 2 + 0.6

const sx = (x: number) => x - YARD.origin.x
const sy = (y: number) => H - (y - YARD.origin.y)

interface Props {
  robots: Robot[]
  selected: string | null
  onSelect: (id: string) => void
  trails: Trails
}

export function YardMap({ robots, selected, onSelect, trails }: Props) {
  const xs = gridLines(W, YARD.grid)
  const ys = gridLines(H, YARD.grid)
  const ax = axes(YARD)
  const scale = scaleHint(YARD)
  const now = Date.now()
  return (
    <svg
      className="yard"
      viewBox={`${sx(FRAME.minX)} ${sy(FRAME.maxY)} ${FRAME.maxX - FRAME.minX} ${FRAME.maxY - FRAME.minY}`}
      role="img"
      aria-label="Yard map"
    >
      <rect className="floor" x={0} y={0} width={W} height={H} />
      <g className="grid">
        {xs.map((x) => (
          <line key={`x${x}`} x1={x} y1={0} x2={x} y2={H} />
        ))}
        {ys.map((y) => (
          <line key={`y${y}`} x1={0} y1={H - y} x2={W} y2={H - y} />
        ))}
      </g>
      <rect className="border" x={0} y={0} width={W} height={H} />

      <g className="axes">
        <line className="axis-x" x1={sx(ax.x[0][0])} y1={sy(ax.x[0][1])} x2={sx(ax.x[1][0])} y2={sy(ax.x[1][1])} />
        <line className="axis-y" x1={sx(ax.y[0][0])} y1={sy(ax.y[0][1])} x2={sx(ax.y[1][0])} y2={sy(ax.y[1][1])} />
      </g>

      <g className="edge-labels" fontSize={FONT}>
        {edgeLabels(YARD).map((l) =>
          l.edge === 'bottom' ? (
            <text key={`b${l.x}`} x={sx(l.x)} y={H + L.bottomBaseline} textAnchor="middle">
              {l.text}
            </text>
          ) : (
            <text key={`l${l.y}`} x={-L.leftGap} y={sy(l.y)} textAnchor="end" dominantBaseline="middle">
              {l.text}
            </text>
          ),
        )}
      </g>

      <g className="scale" fontSize={FONT}>
        <path d={`M0 ${H + FONT * 2.4} v${FONT * 0.6} h${scale.meters} v${-FONT * 0.6}`} />
        <text x={scale.meters + FONT * 0.6} y={H + FONT * 3} dominantBaseline="middle">
          {scale.label} · metres
        </text>
      </g>

      <g className="trails">
        {robots.map((r) =>
          segments(trails.current.get(r.robot_id) ?? [], now).map((s, i) => (
            <line
              key={`${r.robot_id}-${i}`}
              x1={sx(s.a.x)}
              y1={sy(s.a.y)}
              x2={sx(s.b.x)}
              y2={sy(s.b.y)}
              stroke={statusColor(r.status)}
              strokeOpacity={s.fade * 0.8}
            />
          )),
        )}
      </g>

      {robots.map((r) => {
        const s = r.last_state
        if (!s) return null
        return (
          <g key={r.robot_id} className="robot" transform={`translate(${sx(s.x)} ${sy(s.y)})`} onClick={() => onSelect(r.robot_id)}>
            {r.robot_id === selected && <circle r={HALO_R} className="halo" />}
            {/* Top-down rover: robot frame is x forward, y left; SVG y points down, so flip y with scale. */}
            <g transform={`rotate(${svgRotation(s.heading)}) scale(1 -1)`}>
              {GLYPH.wheels.map((w, i) => (
                <rect key={i} className="wheel" x={w.x - w.w / 2} y={w.y - w.h / 2} width={w.w} height={w.h} rx={w.h * 0.3} />
              ))}
              <rect
                className="body"
                x={GLYPH.body.x - GLYPH.body.w / 2}
                y={GLYPH.body.y - GLYPH.body.h / 2}
                width={GLYPH.body.w}
                height={GLYPH.body.h}
                rx={GLYPH.body.h * 0.18}
                fill={statusColor(r.status)}
              />
              <polygon className="nose" points={GLYPH.nose.map((p) => p.join(',')).join(' ')} />
            </g>
            <text y={-HALO_R - 0.6}>{r.robot_id}</text>
          </g>
        )
      })}
    </svg>
  )
}
