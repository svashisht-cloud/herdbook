import { useEffect, useRef } from 'react'
import { robotGlyph, svgRotation } from '../scene/glyph'
import { poseAt, type Pose } from '../scene/interpolate'
import { axes, edgeLabels, labelLayout, mapFrame, scaleHint } from '../scene/yardDecor'
import { drawnPoints, segments } from '../scene/trail'
import { statusColor } from '../status'
import type { Robot } from '../types'
import type { Tracks } from '../useTracks'
import type { Trails } from '../useTrails'
import { gridLines, useYard } from '../yard'

// Everything here derives from the yard (decisions log: Yard bounds), which comes from the loaded map.
// ROS y points up and SVG y points down, so y is flipped.
const GLYPH = robotGlyph()
const HALO_R = Math.hypot(GLYPH.body.w, GLYPH.body.h) / 2 + 0.6

interface Props {
  robots: Robot[]
  selected: string | null
  onSelect: (id: string) => void
  trails: Trails
  tracks: Tracks
}

// The elements an animation frame moves for one robot (decisions log: Pose interpolation).
interface RobotEls {
  outer: SVGGElement | null // translate
  inner: SVGGElement | null // rotate
  head: SVGLineElement | null // trail's last drawn point -> the robot
}

/** The interpolated pose, or the last known state for a robot with no samples yet. */
function drawnPose(r: Robot, tracks: Tracks, now: number): Pose | null {
  return poseAt(tracks.current.get(r.robot_id) ?? [], now) ?? r.last_state
}

const rotateAttr = (heading: number) => `rotate(${svgRotation(heading)}) scale(1 -1)`

export function YardMap({ robots, selected, onSelect, trails, tracks }: Props) {
  const { config: yard, image } = useYard()
  const W = yard.width
  const H = yard.height
  const FRAME = mapFrame(yard) // the same box the 3D canvas frames, so the two views line up
  const L = labelLayout(yard)
  const FONT = L.font
  const sx = (x: number) => x - yard.origin.x
  const sy = (y: number) => H - (y - yard.origin.y)
  const xs = gridLines(W, yard.grid)
  const ys = gridLines(H, yard.grid)
  const ax = axes(yard)
  const scale = scaleHint(yard)
  const now = Date.now()

  // Robots move every animation frame by writing SVG attributes through refs, so a frame never re-renders
  // React. React still renders on telemetry (2 Hz), with the same pose, so the two never disagree.
  const els = useRef(new Map<string, RobotEls>())
  const live = useRef({ robots, sx, sy })
  live.current = { robots, sx, sy }
  const elsFor = (id: string): RobotEls => {
    let e = els.current.get(id)
    if (!e) els.current.set(id, (e = { outer: null, inner: null, head: null }))
    return e
  }
  useEffect(() => {
    let raf = 0
    const frame = () => {
      const t = Date.now()
      const { robots, sx, sy } = live.current
      for (const r of robots) {
        const e = els.current.get(r.robot_id)
        const p = e && drawnPose(r, tracks, t)
        if (!e || !p) continue
        e.outer?.setAttribute('transform', `translate(${sx(p.x)} ${sy(p.y)})`)
        e.inner?.setAttribute('transform', rotateAttr(p.heading))
        const pts = drawnPoints(trails.current.get(r.robot_id) ?? [], t)
        const last = pts[pts.length - 1]
        if (e.head) {
          e.head.setAttribute('visibility', last ? 'visible' : 'hidden')
          if (last) {
            e.head.setAttribute('x1', `${sx(last.x)}`)
            e.head.setAttribute('y1', `${sy(last.y)}`)
            e.head.setAttribute('x2', `${sx(p.x)}`)
            e.head.setAttribute('y2', `${sy(p.y)}`)
          }
        }
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [tracks, trails])

  return (
    <svg
      className="yard"
      viewBox={`${sx(FRAME.minX)} ${sy(FRAME.maxY)} ${FRAME.maxX - FRAME.minX} ${FRAME.maxY - FRAME.minY}`}
      role="img"
      aria-label="Floor map"
    >
      <rect className="floor" x={0} y={0} width={W} height={H} />
      {/* The occupancy map, top row first like the PGM: its top edge is the yard's top (max y). */}
      {image && <image className="map-image" href={image.url} x={0} y={0} width={W} height={H} preserveAspectRatio="none" />}
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
        {edgeLabels(yard).map((l) =>
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
        {robots.map((r) => [
          ...segments(drawnPoints(trails.current.get(r.robot_id) ?? [], now), now).map((s, i) => (
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
          // Joins the trail to the robot; positioned every frame.
          <line
            key={`${r.robot_id}-head`}
            ref={(el) => void (elsFor(r.robot_id).head = el)}
            visibility="hidden"
            stroke={statusColor(r.status)}
            strokeOpacity={0.8}
          />,
        ])}
      </g>

      {robots.map((r) => {
        const s = drawnPose(r, tracks, now)
        if (!s) return null
        return (
          <g
            key={r.robot_id}
            ref={(el) => void (elsFor(r.robot_id).outer = el)}
            className="robot"
            transform={`translate(${sx(s.x)} ${sy(s.y)})`}
            onClick={() => onSelect(r.robot_id)}
          >
            {r.robot_id === selected && <circle r={HALO_R} className="halo" />}
            {/* Top-down rover: robot frame is x forward, y left; SVG y points down, so flip y with scale. */}
            <g ref={(el) => void (elsFor(r.robot_id).inner = el)} transform={rotateAttr(s.heading)}>
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
