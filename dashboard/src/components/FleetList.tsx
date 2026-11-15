import { statusColor } from '../status'
import type { Status } from '../types'
import type { Robot } from '../types'
import { useNow } from '../useNow'
import { ago, pct } from '../format'

interface Props {
  robots: Robot[]
  selected: string | null
  onSelect: (id: string) => void
}

export function FleetList({ robots, selected, onSelect }: Props) {
  const now = useNow()
  const counts = robots.reduce<Record<Status, number>>(
    (acc, r) => ({ ...acc, [r.status]: acc[r.status] + 1 }),
    { online: 0, degraded: 0, offline: 0 },
  )
  return (
    <section className="panel fleet-panel">
      <div className="panel-head">
        <h2>Robots</h2>
        <div className="counts">
          {(['online', 'degraded', 'offline'] as const).map((st) => (
            <span key={st} className="status">
              <i className="dot" style={{ background: statusColor(st) }} />
              {counts[st]} {st}
            </span>
          ))}
        </div>
      </div>
    <table className="fleet">
      <thead>
        <tr>
          <th>Robot</th>
          <th>Status</th>
          <th>Mode</th>
          <th className="num">Battery</th>
          <th className="num">Last seen</th>
        </tr>
      </thead>
      <tbody>
        {robots.map((r) => {
          return (
            <tr
              key={r.robot_id}
              className={r.robot_id === selected ? 'selected' : undefined}
              onClick={() => onSelect(r.robot_id)}
            >
              <td>{r.robot_id}</td>
              <td>
                <span className="status">
                  <i className="dot" style={{ background: statusColor(r.status) }} />
                  {r.status}
                </span>
              </td>
              <td>{r.last_state?.mode ?? '—'}</td>
              <td className="num">{pct(r.last_state?.battery)}</td>
              <td className="num">{r.last_seen == null ? 'never' : ago(now - r.last_seen)}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
    </section>
  )
}
