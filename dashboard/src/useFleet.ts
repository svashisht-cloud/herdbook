import { useCallback, useEffect, useRef, useState } from 'react'
import type { Incident, Robot, Status, Telemetry, WsMessage } from './types'

const BACKOFF_MIN_MS = 1000
const BACKOFF_MAX_MS = 10000

type Listener = (t: Telemetry) => void
type IncidentListener = (i: Incident) => void

/**
 * Fleet state from GET /api/robots plus live /ws updates.
 *
 * Reconnects with backoff (1 s doubling to 10 s) and reloads /api/robots on every
 * (re)connect, because a WebSocket doesn't replay what was missed (decisions log).
 * `epoch` goes up on every (re)connect, so the open chart and the incidents list
 * refetch too (decisions log: Reload everything on reconnect).
 */
export function useFleet() {
  const [robots, setRobots] = useState<Record<string, Robot>>({})
  const [connected, setConnected] = useState(false)
  const [epoch, setEpoch] = useState(0)
  const listeners = useRef(new Set<Listener>())
  const incidentListeners = useRef(new Set<IncidentListener>())

  const subscribeTelemetry = useCallback((fn: Listener) => {
    listeners.current.add(fn)
    return () => {
      listeners.current.delete(fn)
    }
  }, [])

  const subscribeIncident = useCallback((fn: IncidentListener) => {
    incidentListeners.current.add(fn)
    return () => {
      incidentListeners.current.delete(fn)
    }
  }, [])

  useEffect(() => {
    let ws: WebSocket | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let backoff = BACKOFF_MIN_MS
    let stopped = false
    // Robots whose status arrived over /ws while a /api/robots reload was in flight:
    // that status is newer than the reload's, so the reload must not overwrite it.
    let liveStatusDuringLoad: Set<string> | null = null

    const loadRobots = async () => {
      const seen = new Set<string>()
      liveStatusDuringLoad = seen
      try {
        const res = await fetch('/api/robots')
        if (!res.ok) throw new Error(`GET /api/robots: ${res.status}`)
        const list: Robot[] = await res.json()
        if (stopped) return
        setRobots((prev) => {
          const next: Record<string, Robot> = {}
          for (const r of list) {
            const cur = prev[r.robot_id]
            // State only moves forward: keep live telemetry that's newer than the reload.
            const keepLive = cur?.last_state && (!r.last_state || cur.last_state.ts > r.last_state.ts)
            next[r.robot_id] = {
              ...r,
              status: seen.has(r.robot_id) && cur ? cur.status : r.status,
              last_state: keepLive ? cur.last_state : r.last_state,
              last_seen: keepLive ? cur.last_seen : r.last_seen,
            }
          }
          return next
        })
      } catch (err) {
        console.warn('Robot list reload failed', err)
      } finally {
        if (liveStatusDuringLoad === seen) liveStatusDuringLoad = null
      }
    }

    const onTelemetry = (t: Telemetry) => {
      setRobots((prev) => {
        const cur = prev[t.robot_id]
        if (cur?.last_state && cur.last_state.ts >= t.ts) return prev
        // A robot we haven't listed yet: its status is the DB default until the status topic says otherwise.
        const base: Robot = cur ?? { robot_id: t.robot_id, status: 'offline', last_seen: null, last_state: null }
        return { ...prev, [t.robot_id]: { ...base, last_state: t, last_seen: t.ts } }
      })
      for (const fn of listeners.current) fn(t)
    }

    const onStatus = (robotId: string, status: Status) => {
      liveStatusDuringLoad?.add(robotId)
      setRobots((prev) => {
        const base: Robot = prev[robotId] ?? { robot_id: robotId, status, last_seen: null, last_state: null }
        return { ...prev, [robotId]: { ...base, status } }
      })
    }

    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
      const sock = new WebSocket(`${proto}//${location.host}/ws`)
      ws = sock
      sock.onopen = () => {
        backoff = BACKOFF_MIN_MS
        setConnected(true)
        setEpoch((e) => e + 1)
        void loadRobots()
      }
      sock.onmessage = (ev) => {
        let msg: WsMessage
        try {
          msg = JSON.parse(ev.data as string)
        } catch {
          return
        }
        if (msg.type === 'telemetry') {
          const { type: _type, ...t } = msg
          onTelemetry(t)
        } else if (msg.type === 'status') {
          onStatus(msg.robot_id, msg.status)
        } else if (msg.type === 'incident') {
          for (const fn of incidentListeners.current) fn(msg.incident)
        }
      }
      sock.onerror = () => sock.close()
      sock.onclose = () => {
        if (ws !== sock) return
        ws = null
        setConnected(false)
        if (stopped) return
        timer = setTimeout(connect, backoff)
        backoff = Math.min(backoff * 2, BACKOFF_MAX_MS)
      }
    }

    connect()
    return () => {
      stopped = true
      clearTimeout(timer)
      ws?.close()
    }
  }, [])

  return { robots, connected, epoch, subscribeTelemetry, subscribeIncident }
}
