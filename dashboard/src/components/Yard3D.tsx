import { Line, OrbitControls } from '@react-three/drei'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Suspense, useEffect, useMemo, useRef, useState, type ComponentRef, type RefObject } from 'react'
import {
  CanvasTexture,
  Color,
  DataTexture,
  LinearMipmapLinearFilter,
  NearestFilter,
  RGBAFormat,
  SRGBColorSpace,
  Vector3,
  type Group,
  type Mesh,
  type PerspectiveCamera,
} from 'three'
import { FOCUS_HEIGHT_M, homeView, stepCamera, type CameraPhase, type CameraView } from '../scene/camera'
import { stepPose, type Pose2 } from '../scene/smoothing'
import { rosToThree, yardPlane } from '../scene/transform'
import { hitRadius } from '../scene/pick'
import { ROBOT_MODEL } from '../scene/robotModel'
import { TRAIL_MAX_POINTS, segments as trailSegments } from '../scene/trail'
import { INTRO_MS, OUTRO_MS, POP_MIN, easeInOutCubic, lerpView, popScale, progress, topDownView } from '../scene/transition'
import { axes, edgeLabels, labelLayout, mapFrame, scaleHint } from '../scene/yardDecor'
import { statusColor } from '../status'
import { THEME } from '../theme'
import type { Trails } from '../useTrails'
import type { Robot } from '../types'
import { gridLines, useYard, type YardConfig, type YardImage } from '../yard'
import { ModelErrorBoundary } from './ModelErrorBoundary'
import { RobotModel, preloadRobotModel } from './RobotModel'

preloadRobotModel(ROBOT_MODEL)

// Thin R3F layer: geometry and wiring only. Transform, smoothing and color live in plain modules.
const BOX: [number, number, number] = [2.4, 1, 1.6] // fallback body: length (along heading), height, width, metres
const RING: [number, number] = [1.4, 1.75] // status ring inner/outer radius, metres
const HALO: [number, number] = [1.9, 2.15] // selection halo, outside the status ring (same blue as the 2D map)
const CLICK_SLOP_PX = 5 // a pointer that moved further than this was an orbit drag, not a click
const C = THEME.color // every scene color comes from the theme (decisions log: Theme tokens)
const LABEL_H_PER_FONT = 1 / 0.5625 // sprite height per 2D font size: the sprite's text is 36 px of 64
const FOV = 45
const FADE_MS = 150 // canvas cross-fade with the 2D map at the ends of a transition
const HIT_Y = 1 // hit sphere centre, metres above the floor
const TRAIL_REFRESH_S = 0.2
const LIFT = { grid: 0.05, boundary: 0.1, axes: 0.15, trail: 0.12 } // metres above the floor, to avoid z-fighting
// A trail's line has a fixed number of segments: three caches a line's instance count at its first
// draw, so a geometry that grows later is clipped. Unused segments are parked under the opaque floor.
// The initial arrays are module constants so a re-render (2 Hz, on telemetry) never hands drei new
// props that would reset the geometry that useFrame writes.
const TRAIL_SEGMENTS = TRAIL_MAX_POINTS // up to MAX-1 buffer segments plus one to the drawn pose
const PARKED_Y = -1
const TRAIL_INIT_POINTS: [number, number, number][] = Array.from({ length: TRAIL_SEGMENTS * 2 }, () => [0, PARKED_Y, 0])
const TRAIL_INIT_COLORS: [number, number, number][] = Array.from({ length: TRAIL_SEGMENTS * 2 }, () => [1, 1, 1])
const WHITE = new Color(1, 1, 1) // leaves per-vertex colors untouched (the material color multiplies them)

// Each robot's drawn (smoothed) pose, written by RobotView every frame and read by the camera rig.
type Poses = RefObject<Map<string, Pose2>>
// Robot height scale during a 2D<->3D transition (1 = normal), written by TransitionRig.
type Pop = RefObject<number>

export type ViewTransition = 'in' | 'out' | null

interface Props {
  robots: Robot[]
  selected: string | null
  onSelect: (id: string | null) => void
  trails: Trails
  transition: ViewTransition // 'in': fly down from the 2D-matching top view; 'out': fly back up
  onTransitionEnd: () => void
}

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** ROS (x, y) -> three point at a height above the floor. */
const at = (x: number, y: number, h: number): [number, number, number] => {
  const p = rosToThree({ x, y, heading: 0 }).position
  return [p[0], h, p[2]]
}

export function Yard3D({ robots, selected, onSelect, trails, transition, onTransitionEnd }: Props) {
  const { config: yard, image } = useYard()
  const FRAME = mapFrame(yard) // the 2D map's frame: same aspect, so the top-down camera matches it
  const { center, size } = yardPlane(yard)
  const span = Math.max(...size)
  const home = homeView(center, span)
  const top = topDownView(yard, FRAME.aspect, FOV)
  const floorTexture = useFloorTexture(image)
  const poses: Poses = useRef(new Map<string, Pose2>())
  const pop: Pop = useRef(transition === 'in' ? POP_MIN : 1)
  // Hidden until the first frame on the way in, and faded out at the end on the way out.
  const [shown, setShown] = useState(transition !== 'in')
  const instant = reducedMotion()
  // Where the camera and orbit target start. Fixed at mount: OrbitControls re-applies its target prop on
  // every render, and after mount the rigs own the camera.
  const [initial] = useState(() => (transition === 'in' ? top : home))

  const onRigDone = () => {
    if (transition === 'out') {
      setShown(false)
      setTimeout(onTransitionEnd, instant ? 0 : FADE_MS)
    } else onTransitionEnd()
  }

  // Esc leaves the close-up (and clears the shared selection, as in the 2D map).
  useEffect(() => {
    if (!selected) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onSelect(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, onSelect])

  // A robot under the pointer when the view unmounts would leave the pointer cursor stuck.
  useEffect(() => () => void (document.body.style.cursor = ''), [])

  const onGroundClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta <= CLICK_SLOP_PX) onSelect(null)
  }

  return (
    <div className={shown ? 'yard3d' : 'yard3d hidden'} style={{ aspectRatio: `${FRAME.aspect}` }}>
      {selected && !transition && (
        <button type="button" className="show-all" onClick={() => onSelect(null)}>
          Show all
        </button>
      )}
      <span className="scale-chip">grid {scaleHint(yard).label}</span>
      {/* near 0.5 m (not 0.1): depth precision at ~120 m keeps the grid and lines from z-fighting the floor. */}
      <Canvas camera={{ position: initial.position, fov: FOV, near: 0.5, far: 2000 }}>
        <color attach="background" args={[C.bg]} />
        <ambientLight intensity={1.6} />
        <directionalLight position={[center[0] + span * 0.3, span * 0.6, center[2] + span * 0.2]} intensity={1.2} />
        <mesh position={center} rotation={[-Math.PI / 2, 0, 0]} onClick={onGroundClick}>
          <planeGeometry args={size} />
          {/* polygonOffset pushes the floor back in depth so the grid and lines on it always win. */}
          {/* With a map, the occupancy texture is the floor (its free color equals the floor color).
              key: switching between color and texture needs a new material (a shader change). */}
          <meshBasicMaterial
            key={floorTexture ? floorTexture.uuid : 'plain'}
            color={floorTexture ? WHITE : C.floor}
            map={floorTexture}
            toneMapped={false}
            polygonOffset
            polygonOffsetFactor={1}
            polygonOffsetUnits={1}
          />
        </mesh>
        <YardDecor yard={yard} />
        {robots.map((r) =>
          r.last_state ? <Trail key={`trail-${r.robot_id}`} robot={r} trails={trails} poses={poses} /> : null,
        )}
        {robots.map((r) =>
          r.last_state ? (
            <RobotView key={r.robot_id} robot={r} selected={r.robot_id === selected} poses={poses} pop={pop} onSelect={onSelect} />
          ) : null,
        )}
        <OrbitControls makeDefault target={initial.target} maxPolarAngle={Math.PI / 2 - 0.05} enabled={!transition} />
        <CameraRig focusId={selected} poses={poses} home={home} paused={!!transition} />
        {transition && (
          <TransitionRig
            key={transition}
            direction={transition}
            home={home}
            top={top}
            pop={pop}
            durationMs={instant ? 0 : transition === 'in' ? INTRO_MS : OUTRO_MS}
            onFirstFrame={() => setShown(true)}
            onDone={onRigDone}
          />
        )}
      </Canvas>
    </div>
  )
}

// Drives the camera from the pure stepCamera: zoom in on and follow the selected robot, or ease home.
// It reads the live camera and orbit target each frame, so the user can still orbit and zoom.
function CameraRig({ focusId, poses, home, paused }: { focusId: string | null; poses: Poses; home: CameraView; paused: boolean }) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as unknown as { target: Vector3; update(): void } | null
  const phase = useRef<CameraPhase>('free')

  useFrame((_, dt) => {
    if (!controls || paused) return
    const p = focusId ? poses.current.get(focusId) : undefined
    const next = stepCamera(
      { position: camera.position.toArray(), target: controls.target.toArray(), phase: phase.current },
      p ? [p.x, FOCUS_HEIGHT_M, p.z] : null,
      home,
      dt,
    )
    phase.current = next.phase
    if (next.phase === 'free') return
    camera.position.set(...next.position)
    controls.target.set(...next.target)
    controls.update()
  })
  return null
}

// Flies the camera between the 2D-matching top view and the 3D home view, and drives the robots' pop
// scale, from the pure functions in scene/transition.ts. The clock starts on the first rendered frame,
// so a slow first load of the 3D chunk or the model can't eat the animation.
interface TransitionRigProps {
  direction: 'in' | 'out'
  home: CameraView
  top: CameraView
  pop: Pop
  durationMs: number
  onFirstFrame: () => void
  onDone: () => void
}

function TransitionRig({ direction, home, top, pop, durationMs, onFirstFrame, onDone }: TransitionRigProps) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as unknown as { target: Vector3; update(): void } | null
  const start = useRef<{ at: number; from: CameraView } | null>(null)
  const done = useRef(false)

  useFrame(() => {
    if (!controls || done.current) return
    const now = performance.now()
    if (!start.current) {
      // 'out' starts from wherever the camera is (it may be following a robot); 'in' from the top view.
      const from: CameraView = direction === 'in' ? top : { position: camera.position.toArray(), target: controls.target.toArray() }
      start.current = { at: now, from }
      onFirstFrame()
    }
    const p = progress(now - start.current.at, durationMs)
    const to = direction === 'in' ? home : top
    const v = lerpView(start.current.from, to, easeInOutCubic(p))
    camera.position.set(...v.position)
    controls.target.set(...v.target)
    controls.update()
    pop.current = popScale(direction === 'in' ? p : 1 - p)
    if (p >= 1) {
      done.current = true
      onDone()
    }
  })
  return null
}

interface RobotViewProps {
  robot: Robot
  selected: boolean
  poses: Poses
  pop: Pop
  onSelect: (id: string) => void
}

function RobotView({ robot, selected, poses, pop, onSelect }: RobotViewProps) {
  const group = useRef<Group>(null)
  const body = useRef<Group>(null)
  const hit = useRef<Mesh>(null)
  const camera = useThree((s) => s.camera) as PerspectiveCamera
  const viewportH = useThree((s) => s.size.height)
  const world = useMemo(() => new Vector3(), [])
  const target = useRef<Pose2 | null>(null)
  const drawn = useRef<Pose2 | null>(null)

  // New telemetry only moves the target; useFrame eases the mesh toward it without React state.
  useEffect(() => {
    const s = robot.last_state
    if (!s) return
    const { position, yaw } = rosToThree(s)
    target.current = { x: position[0], z: position[2], yaw }
  }, [robot.last_state])

  useFrame((_, dt) => {
    const g = group.current
    if (!g || !target.current) return
    const p = stepPose(drawn.current, target.current, dt)
    drawn.current = p
    poses.current.set(robot.robot_id, p)
    g.position.set(p.x, 0, p.z)
    g.rotation.y = p.yaw
    if (body.current) body.current.scale.y = pop.current
    // Keep the click target at least PICK_MIN_PX on screen however far away the robot is.
    if (hit.current) {
      const d = camera.position.distanceTo(world.set(p.x, HIT_Y, p.z))
      hit.current.scale.setScalar(hitRadius(d, camera.fov, viewportH))
    }
  })

  useEffect(() => {
    const map = poses.current
    const id = robot.robot_id
    return () => {
      map.delete(id)
    }
  }, [poses, robot.robot_id])

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation() // don't also hit the ground (which deselects)
    if (e.delta <= CLICK_SLOP_PX) onSelect(robot.robot_id)
  }

  const fallback = <BoxBody />
  return (
    <group
      ref={group}
      onClick={onClick}
      onPointerOver={(e) => {
        e.stopPropagation()
        document.body.style.cursor = 'pointer'
      }}
      onPointerOut={() => {
        document.body.style.cursor = ''
      }}
    >
      {selected && (
        <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[HALO[0], HALO[1], 48]} />
          <meshBasicMaterial color={C.accent} toneMapped={false} />
        </mesh>
      )}
      {/* Color comes from status only, as a ring on the ground; the model's own materials are untouched. */}
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[RING[0], RING[1], 48]} />
        <meshBasicMaterial color={statusColor(robot.status)} toneMapped={false} />
      </mesh>
      {/* Invisible click target (decisions log: 3D pick radius): raycast only, never drawn. */}
      <mesh ref={hit} position={[0, HIT_Y, 0]}>
        <sphereGeometry args={[1, 16, 8]} />
        <meshBasicMaterial colorWrite={false} depthWrite={false} />
      </mesh>
      {/* Scaled in height by the 2D<->3D transition, so robots pop up out of the flat top view. */}
      <group ref={body}>
        <ModelErrorBoundary url={ROBOT_MODEL.url} fallback={fallback}>
          <Suspense fallback={fallback}>
            <RobotModel cfg={ROBOT_MODEL} />
          </Suspense>
        </ModelErrorBoundary>
      </group>
      <Label text={robot.robot_id} position={[0, BOX[1] + 1.4, 0]} height={2.5} />
    </group>
  )
}

// Placeholder body while the model loads or if it fails. The nose marker on +x shows heading.
function BoxBody() {
  return (
    <group>
      <mesh position={[0, BOX[1] / 2, 0]}>
        <boxGeometry args={BOX} />
        <meshStandardMaterial color={C.robotBody} />
      </mesh>
      <mesh position={[BOX[0] / 2 + 0.3, BOX[1] / 2, 0]}>
        <boxGeometry args={[0.6, 0.4, 0.4]} />
        <meshStandardMaterial color={C.robotBody} />
      </mesh>
    </group>
  )
}

// Text drawn to a canvas texture on a sprite, so it always faces the camera and stays in the WebGL scene.
function Label({ text, position, height, color = C.text }: { text: string; position: [number, number, number]; height: number; color?: string }) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 64
    const ctx = canvas.getContext('2d')!
    ctx.font = `600 36px ${THEME.font.family}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = color
    ctx.fillText(text, canvas.width / 2, canvas.height / 2)
    const t = new CanvasTexture(canvas)
    t.colorSpace = SRGBColorSpace
    return t
  }, [text, color])
  useEffect(() => () => texture.dispose(), [texture])
  return (
    <sprite position={position} scale={[height * 4, height, 1]}>
      <spriteMaterial map={texture} transparent depthWrite={false} toneMapped={false} />
    </sprite>
  )
}

// The map texture for the floor: bottom row first, which is a DataTexture's v = 0, and the rotated floor
// plane puts v = 0 at the yard's bottom (ROS min y). Crisp up close, mipmapped at a distance.
function useFloorTexture(image: YardImage | null): DataTexture | null {
  const texture = useMemo(() => {
    if (!image) return null
    const t = new DataTexture(image.rgba, image.width, image.height, RGBAFormat)
    t.colorSpace = SRGBColorSpace
    t.magFilter = NearestFilter
    t.minFilter = LinearMipmapLinearFilter
    t.generateMipmaps = true
    t.needsUpdate = true
    return t
  }, [image])
  useEffect(() => () => texture?.dispose(), [texture])
  return texture
}

// Grid, boundary, origin axes and metre labels, all from the yard (decisions log: Yard bounds). The grid
// uses the same gridLines() as the 2D map, so both views draw exactly the same lines.
function YardDecor({ yard }: { yard: YardConfig }) {
  const { x: ox, y: oy } = yard.origin
  const { width: W, height: H, grid } = yard
  const gridPoints = useMemo(() => {
    const pts: [number, number, number][] = []
    for (const d of gridLines(W, grid)) pts.push(at(ox + d, oy, LIFT.grid), at(ox + d, oy + H, LIFT.grid))
    for (const d of gridLines(H, grid)) pts.push(at(ox, oy + d, LIFT.grid), at(ox + W, oy + d, LIFT.grid))
    return pts
  }, [ox, oy, W, H, grid])
  const corners = [at(ox, oy, LIFT.boundary), at(ox + W, oy, LIFT.boundary), at(ox + W, oy + H, LIFT.boundary), at(ox, oy + H, LIFT.boundary)]
  const ax = axes(yard)
  const LABELS = labelLayout(yard)
  const LABEL_H = LABELS.font * LABEL_H_PER_FONT
  return (
    <group>
      <Line points={gridPoints} segments color={C.floorGrid} lineWidth={1} toneMapped={false} />
      <Line points={[...corners, corners[0]]} color={C.floorBoundary} lineWidth={2} toneMapped={false} />
      <Line points={ax.x.map(([x, y]) => at(x, y, LIFT.axes))} color={C.axisX} lineWidth={3} toneMapped={false} />
      <Line points={ax.y.map(([x, y]) => at(x, y, LIFT.axes))} color={C.axisY} lineWidth={3} toneMapped={false} />
      {edgeLabels(yard).map((l) => (
        <Label
          key={`${l.edge}${l.x},${l.y}`}
          text={l.text}
          height={LABEL_H}
          color={C.textMuted}
          position={
            l.edge === 'bottom' ? at(l.x, oy - LABELS.bottomCenter, 0.1) : at(ox - LABELS.leftGap - LABELS.width(l.text) / 2, l.y, 0.1)
          }
        />
      ))}
    </group>
  )
}

// A fading line behind a robot (decisions log: Trails). Points come from the trail ref; the newest
// vertex is the robot's smoothed drawn pose so the trail stays attached to the model. The geometry is
// rebuilt imperatively a few times a second; fade blends the status color into the floor color.
function Trail({ robot, trails, poses }: { robot: Robot; trails: Trails; poses: Poses }) {
  const line = useRef<ComponentRef<typeof Line>>(null)
  const since = useRef(Infinity)
  const color = statusColor(robot.status)

  useFrame((_, dt) => {
    since.current += dt
    const l = line.current
    if (!l || since.current < TRAIL_REFRESH_S) return
    since.current = 0
    const now = Date.now()
    const buf = trails.current.get(robot.robot_id) ?? []
    const segs = trailSegments(buf, now).map((s) => ({ a: [s.a.x, s.a.y], b: [s.b.x, s.b.y], fade: s.fade }))
    const last = buf[buf.length - 1]
    const head = poses.current.get(robot.robot_id)
    if (last && head) {
      // three (x, z) back to ROS (x, y): y = -z. Join the last point to where the robot is drawn now.
      segs.push({ a: [last.x, last.y], b: [head.x, -head.z], fade: 1 })
    }
    const base = new Color(color)
    const floor = new Color(C.floor)
    const positions: number[] = []
    const colors: number[] = []
    for (const s of segs.slice(-TRAIL_SEGMENTS)) {
      for (const [x, y] of [s.a, s.b]) positions.push(...at(x, y, LIFT.trail))
      const c = floor.clone().lerp(base, s.fade * 0.85)
      colors.push(c.r, c.g, c.b, c.r, c.g, c.b)
    }
    while (positions.length < TRAIL_SEGMENTS * 6) {
      positions.push(0, PARKED_Y, 0)
      colors.push(floor.r, floor.g, floor.b)
    }
    l.geometry.setPositions(positions)
    l.geometry.setColors(colors)
  })

  return <Line ref={line} segments points={TRAIL_INIT_POINTS} vertexColors={TRAIL_INIT_COLORS} color={WHITE} lineWidth={2.5} toneMapped={false} />
}
