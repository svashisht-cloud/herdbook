import { Grid, OrbitControls } from '@react-three/drei'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Suspense, useEffect, useMemo, useRef, type RefObject } from 'react'
import { CanvasTexture, SRGBColorSpace, type Group, type Vector3 } from 'three'
import { FOCUS_HEIGHT_M, homeView, stepCamera, type CameraPhase, type CameraView } from '../scene/camera'
import { stepPose, type Pose2 } from '../scene/smoothing'
import { rosToThree, yardPlane } from '../scene/transform'
import { ROBOT_MODEL } from '../scene/robotModel'
import { statusColor } from '../status'
import type { Robot } from '../types'
import { YARD } from '../yard'
import { ModelErrorBoundary } from './ModelErrorBoundary'
import { RobotModel, preloadRobotModel } from './RobotModel'

preloadRobotModel(ROBOT_MODEL)

// Thin R3F layer: geometry and wiring only. Transform, smoothing and color live in plain modules.
const BOX: [number, number, number] = [2.4, 1, 1.6] // fallback body: length (along heading), height, width, metres
const RING: [number, number] = [1.4, 1.75] // status ring inner/outer radius, metres
const HALO: [number, number] = [1.9, 2.15] // selection halo, outside the status ring (same blue as the 2D map)
const CLICK_SLOP_PX = 5 // a pointer that moved further than this was an orbit drag, not a click

// Each robot's drawn (smoothed) pose, written by RobotView every frame and read by the camera rig.
type Poses = RefObject<Map<string, Pose2>>

interface Props {
  robots: Robot[]
  selected: string | null
  onSelect: (id: string | null) => void
}

export function Yard3D({ robots, selected, onSelect }: Props) {
  const { center, size } = yardPlane(YARD)
  const span = Math.max(...size)
  const home = homeView(center, span)
  const poses: Poses = useRef(new Map<string, Pose2>())

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
    <div className="yard3d" style={{ aspectRatio: `${size[0] + 4} / ${size[1] + 4}` }}>
      {selected && (
        <button type="button" className="show-all" onClick={() => onSelect(null)}>
          Show all
        </button>
      )}
      <Canvas camera={{ position: home.position, fov: 45 }}>
        <ambientLight intensity={1.6} />
        <directionalLight position={[center[0] + span * 0.3, span * 0.6, center[2] + span * 0.2]} intensity={1.2} />
        <mesh position={center} rotation={[-Math.PI / 2, 0, 0]} onClick={onGroundClick}>
          <planeGeometry args={size} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>
        <Grid
          position={[center[0], 0.01, center[2]]}
          args={size}
          cellSize={YARD.grid}
          cellThickness={0.8}
          cellColor="#d0d7de"
          sectionSize={YARD.grid}
          sectionThickness={0.8}
          sectionColor="#d0d7de"
          fadeDistance={span * 4}
        />
        {robots.map((r) =>
          r.last_state ? (
            <RobotView key={r.robot_id} robot={r} selected={r.robot_id === selected} poses={poses} onSelect={onSelect} />
          ) : null,
        )}
        <OrbitControls makeDefault target={center} maxPolarAngle={Math.PI / 2 - 0.05} />
        <CameraRig focusId={selected} poses={poses} home={home} />
      </Canvas>
    </div>
  )
}

// Drives the camera from the pure stepCamera: zoom in on and follow the selected robot, or ease home.
// It reads the live camera and orbit target each frame, so the user can still orbit and zoom.
function CameraRig({ focusId, poses, home }: { focusId: string | null; poses: Poses; home: CameraView }) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as unknown as { target: Vector3; update(): void } | null
  const phase = useRef<CameraPhase>('free')

  useFrame((_, dt) => {
    if (!controls) return
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

interface RobotViewProps {
  robot: Robot
  selected: boolean
  poses: Poses
  onSelect: (id: string) => void
}

function RobotView({ robot, selected, poses, onSelect }: RobotViewProps) {
  const group = useRef<Group>(null)
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
          <meshBasicMaterial color="#2563eb" />
        </mesh>
      )}
      {/* Color comes from status only, as a ring on the ground; the model's own materials are untouched. */}
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[RING[0], RING[1], 48]} />
        <meshBasicMaterial color={statusColor(robot.status)} />
      </mesh>
      <ModelErrorBoundary url={ROBOT_MODEL.url} fallback={fallback}>
        <Suspense fallback={fallback}>
          <RobotModel cfg={ROBOT_MODEL} />
        </Suspense>
      </ModelErrorBoundary>
      <Label text={robot.robot_id} y={BOX[1] + 1.4} />
    </group>
  )
}

// Placeholder body while the model loads or if it fails. The nose marker on +x shows heading.
function BoxBody() {
  return (
    <group>
      <mesh position={[0, BOX[1] / 2, 0]}>
        <boxGeometry args={BOX} />
        <meshStandardMaterial color="#57606a" />
      </mesh>
      <mesh position={[BOX[0] / 2 + 0.3, BOX[1] / 2, 0]}>
        <boxGeometry args={[0.6, 0.4, 0.4]} />
        <meshStandardMaterial color="#57606a" />
      </mesh>
    </group>
  )
}

// Text drawn to a canvas texture on a sprite, so it always faces the camera and stays in the WebGL scene.
function Label({ text, y }: { text: string; y: number }) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 64
    const ctx = canvas.getContext('2d')!
    ctx.font = '600 36px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#1f2328'
    ctx.fillText(text, canvas.width / 2, canvas.height / 2)
    const t = new CanvasTexture(canvas)
    t.colorSpace = SRGBColorSpace
    return t
  }, [text])
  useEffect(() => () => texture.dispose(), [texture])
  return (
    <sprite position={[0, y, 0]} scale={[10, 2.5, 1]}>
      <spriteMaterial map={texture} transparent depthWrite={false} />
    </sprite>
  )
}
