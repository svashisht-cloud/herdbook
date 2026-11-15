import type { Incident, Robot } from '../types'
import { useNow } from '../useNow'

// Fleet health at a glance (decisions log: KPI bar). Data lag is the age of the newest telemetry from
// any robot: if it climbs, the whole pipeline (broker, ingest or this page's WebSocket) has stalled.

interface Props {
  robots: Robot[]
  incidents: Incident[]
  connected: boolean
}

function lagText(ms: number | null): string {
  if (ms == null) return '—'
  if (ms < 1500) return '<1 s'
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`
  return `${Math.round(ms / 60_000)} min`
}

export function KpiBar({ robots, incidents, connected }: Props) {
  const now = useNow()
  const count = (s: Robot['status']) => robots.filter((r) => r.status === s).length
  const newest = robots.reduce<number | null>((m, r) => (r.last_seen == null ? m : Math.max(m ?? 0, r.last_seen)), null)
  const lag = newest == null ? null : now - newest
  const open = incidents.filter((i) => i.status === 'recording').length
  const tiles: { label: string; value: string; tone?: string }[] = [
    { label: 'online', value: `${count('online')}/${robots.length}`, tone: 'online' },
    { label: 'degraded', value: `${count('degraded')}`, tone: count('degraded') ? 'degraded' : undefined },
    { label: 'offline', value: `${count('offline')}`, tone: count('offline') ? 'offline' : undefined },
    { label: 'open incidents', value: `${open}`, tone: open ? 'degraded' : undefined },
    { label: 'incidents 24 h', value: `${incidents.length}` },
    { label: 'data lag', value: connected ? lagText(lag) : '—', tone: connected && lag != null && lag > 5000 ? 'danger' : undefined },
  ]
  return (
    <dl className="kpis">
      {tiles.map((t) => (
        <div key={t.label} className={t.tone ? `kpi ${t.tone}` : 'kpi'}>
          <dt>{t.label}</dt>
          <dd>{t.value}</dd>
        </div>
      ))}
    </dl>
  )
}
