import { RobotCharts } from '../components/RobotCharts'
import { ago, pct } from '../format'
import { statusColor } from '../status'
import type { Robot, Telemetry } from '../types'
import { useNow } from '../useNow'

interface Props {
  robots: Robot[]
  selected: string | null
  onSelect: (id: string) => void
  onShowOnMap: (id: string) => void
  epoch: number
  subscribeTelemetry: (fn: (t: Telemetry) => void) => () => void
}

/** One card per robot; the selected robot's charts below (the same selection as the map). */
export function RobotsPage({ robots, selected, onSelect, onShowOnMap, epoch, subscribeTelemetry }: Props) {
  const now = useNow()
  return (
    <>
      <div className="robot-cards">
        {robots.map((r) => {
          const s = r.last_state
          return (
            <article
              key={r.robot_id}
              className={r.robot_id === selected ? 'panel robot-card selected' : 'panel robot-card'}
              onClick={() => onSelect(r.robot_id)}
            >
              <header>
                <h2>{r.robot_id}</h2>
                <span className="status">
                  <i className="dot" style={{ background: statusColor(r.status) }} />
                  {r.status}
                </span>
              </header>
              <dl className="facts">
                <div>
                  <dt>mode</dt>
                  <dd>{s?.mode ?? '—'}</dd>
                </div>
                <div>
                  <dt>speed</dt>
                  <dd>{s ? `${s.speed.toFixed(2)} m/s` : '—'}</dd>
                </div>
                <div>
                  <dt>position</dt>
                  <dd>{s ? `${s.x.toFixed(1)}, ${s.y.toFixed(1)}` : '—'}</dd>
                </div>
                <div>
                  <dt>last seen</dt>
                  <dd>{r.last_seen == null ? 'never' : ago(now - r.last_seen)}</dd>
                </div>
              </dl>
              <div className="meter" aria-label={`battery ${pct(s?.battery)}`}>
                <span className="meter-label">battery</span>
                <span className="meter-track">
                  <span className="meter-fill" style={{ width: pct(s?.battery) === '—' ? 0 : pct(s?.battery) }} />
                </span>
                <span className="meter-value">{pct(s?.battery)}</span>
              </div>
              <button
                type="button"
                className="link-button"
                onClick={(e) => {
                  e.stopPropagation()
                  onShowOnMap(r.robot_id)
                }}
              >
                show on map →
              </button>
            </article>
          )
        })}
      </div>
      {selected ? (
        <RobotCharts robotId={selected} epoch={epoch} subscribeTelemetry={subscribeTelemetry} />
      ) : (
        <p className="hint">Select a robot to see its speed and battery over the last 10 minutes.</p>
      )}
    </>
  )
}
