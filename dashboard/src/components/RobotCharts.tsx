import { useEffect, useRef, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { THEME } from '../theme'
import type { Telemetry } from '../types'

const C = THEME.color
const TICK = { fill: C.textMuted, fontSize: THEME.font.size.xs }

const WINDOW_MS = 10 * 60 * 1000

/** Dedupe by (boot_id, seq), sort by ts, and keep the last 10 minutes. */
function tidy(rows: Telemetry[]) {
  const byKey = new Map<string, Telemetry>()
  for (const r of rows) byKey.set(`${r.boot_id}:${r.seq}`, r)
  const cutoff = Date.now() - WINDOW_MS
  return [...byKey.values()].filter((r) => r.ts >= cutoff).sort((a, b) => a.ts - b.ts)
}

const timeFmt = (ts: number) => new Date(ts).toLocaleTimeString()

interface Props {
  robotId: string
  epoch: number // goes up on every WebSocket (re)connect: refetch then
  subscribeTelemetry: (fn: (t: Telemetry) => void) => () => void
}

export function RobotCharts({ robotId, epoch, subscribeTelemetry }: Props) {
  const [rows, setRows] = useState<Telemetry[]>([])
  const [error, setError] = useState<string | null>(null)
  const shownRobot = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let loaded = false
    const buffered: Telemetry[] = []
    // A new robot starts empty. After a reconnect, keep what's shown and merge the
    // refetched 10 minutes in: tidy() dedupes by (boot_id, seq).
    const sameRobot = shownRobot.current === robotId
    shownRobot.current = robotId
    if (!sameRobot) setRows([])
    setError(null)

    // Live rows that arrive before the history loads are buffered, then merged in.
    const unsubscribe = subscribeTelemetry((t) => {
      if (t.robot_id !== robotId) return
      if (!loaded) buffered.push(t)
      else setRows((prev) => tidy([...prev, t]))
    })

    fetch(`/api/robots/${encodeURIComponent(robotId)}/telemetry`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<Telemetry[]>
      })
      .then((history) => {
        if (cancelled) return
        loaded = true
        setRows((prev) => tidy([...(sameRobot ? prev : []), ...history, ...buffered]))
      })
      .catch((err) => {
        if (cancelled) return
        loaded = true
        setRows((prev) => tidy([...(sameRobot ? prev : []), ...buffered]))
        setError(`Couldn't load history: ${err.message}`)
      })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [robotId, epoch, subscribeTelemetry])

  const data = rows.map((r) => ({
    ts: r.ts,
    speed: r.speed,
    battery: r.battery == null ? null : r.battery * 100,
  }))

  return (
    <section className="panel charts">
      <h2>
        {robotId} <span className="muted">last 10 minutes · {rows.length} points</span>
      </h2>
      {error && <p className="error">{error}</p>}
      <div className="chart-grid">
        <Chart title="Speed (m/s)" data={data} dataKey="speed" color={C.accent} />
        <Chart title="Battery (%)" data={data} dataKey="battery" color={C.chartBattery} domain={[0, 100]} />
      </div>
    </section>
  )
}

interface ChartProps {
  title: string
  data: { ts: number; speed: number; battery: number | null }[]
  dataKey: 'speed' | 'battery'
  color: string
  domain?: [number, number]
}

function Chart({ title, data, dataKey, color, domain }: ChartProps) {
  return (
    <div className="chart">
      <h3>{title}</h3>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={C.borderMuted} />
          <XAxis
            dataKey="ts"
            type="number"
            scale="time"
            domain={['dataMin', 'dataMax']}
            tickFormatter={timeFmt}
            minTickGap={40}
            tick={TICK}
            stroke={C.border}
          />
          <YAxis domain={domain ?? ['auto', 'auto']} width={44} tickFormatter={(v: number) => v.toFixed(1)} tick={TICK} stroke={C.border} />
          <Tooltip
            labelFormatter={(v) => timeFmt(Number(v))}
            formatter={(v) => Number(v).toFixed(2)}
            contentStyle={{ background: C.surfaceRaised, border: `1px solid ${C.border}`, borderRadius: THEME.radius.sm }}
            labelStyle={{ color: C.textMuted }}
            itemStyle={{ color: C.text }}
            cursor={{ stroke: C.border }}
          />
          <Line dataKey={dataKey} stroke={color} dot={false} isAnimationActive={false} connectNulls={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
