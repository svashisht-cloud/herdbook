import { Suspense, lazy, useState } from 'react'
import { FleetList } from './components/FleetList'
import { IncidentsPanel } from './components/IncidentsPanel'
import { RobotCharts } from './components/RobotCharts'
import { YardMap } from './components/YardMap'
import { useFleet } from './useFleet'

// three is large, so the 3D view loads only when someone switches to it.
const Yard3D = lazy(() => import('./components/Yard3D').then((m) => ({ default: m.Yard3D })))
type View = '2d' | '3d'

export function App() {
  const { robots, connected, epoch, subscribeTelemetry, subscribeIncident } = useFleet()
  const [selected, setSelected] = useState<string | null>(null)
  const [view, setView] = useState<View>('2d')
  const list = Object.values(robots).sort((a, b) => a.robot_id.localeCompare(b.robot_id))

  return (
    <div className="app">
      <header>
        <h1>Herdbook</h1>
        <span className={connected ? 'live on' : 'live off'}>{connected ? 'live' : 'disconnected'}</span>
        <div className="view-toggle" role="group" aria-label="Map view">
          {(['2d', '3d'] as const).map((v) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}>
              {v.toUpperCase()}
            </button>
          ))}
        </div>
      </header>
      {/* Without this, every robot would freeze while still looking online (decisions log). */}
      {!connected && (
        <div className="banner" role="alert">
          Live connection lost: robot positions and status are not updating. Reconnecting…
        </div>
      )}
      <main>
        <div className="top">
          {view === '2d' ? (
            <YardMap robots={list} selected={selected} onSelect={setSelected} />
          ) : (
            <Suspense fallback={<div className="yard3d loading muted">Loading 3D view…</div>}>
              <Yard3D robots={list} selected={selected} onSelect={setSelected} />
            </Suspense>
          )}
          <FleetList robots={list} selected={selected} onSelect={setSelected} />
        </div>
        {selected ? (
          <RobotCharts robotId={selected} epoch={epoch} subscribeTelemetry={subscribeTelemetry} />
        ) : (
          <p className="muted hint">Click a robot on the map or in the list to see its speed and battery.</p>
        )}
        <IncidentsPanel epoch={epoch} subscribeIncident={subscribeIncident} />
      </main>
    </div>
  )
}
