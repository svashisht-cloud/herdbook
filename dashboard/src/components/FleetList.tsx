import { STATUS_COLOR } from '../status'
import type { Robot } from '../types'
import { useNow } from '../useNow'

function ago(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}

interface Props {
  robots: Robot[]
  selected: string | null
  onSelect: (id: string) => void
}

export function FleetList({ robots, selected, onSelect }: Props) {
  const now = useNow()
  return (
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
          const battery = r.last_state?.battery
          return (
            <tr
              key={r.robot_id}
              className={r.robot_id === selected ? 'selected' : undefined}
              onClick={() => onSelect(r.robot_id)}
            >
              <td>{r.robot_id}</td>
              <td>
                <span className="badge" style={{ background: STATUS_COLOR[r.status] }}>
                  {r.status}
                </span>
              </td>
              <td>{r.last_state?.mode ?? '—'}</td>
              <td className="num">{battery == null ? '—' : `${Math.round(battery * 100)}%`}</td>
              <td className="num">{r.last_seen == null ? 'never' : ago(now - r.last_seen)}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
