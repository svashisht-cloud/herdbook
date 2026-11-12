// Shapes from the ingest API (ARCHITECTURE.md). All timestamps are UTC ms.

export type Status = 'online' | 'degraded' | 'offline'

export interface Telemetry {
  robot_id: string
  boot_id: number
  seq: number
  ts: number
  x: number
  y: number
  heading: number // radians, counter-clockwise from +x (ROS yaw)
  speed: number // m/s
  battery: number | null // 0.0 to 1.0
  mode: string
}

export interface Robot {
  robot_id: string
  status: Status
  last_seen: number | null
  last_state: Telemetry | null
}

export type WsMessage =
  | ({ type: 'telemetry' } & Telemetry)
  | { type: 'status'; robot_id: string; status: Status }
