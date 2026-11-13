import { Suspense, lazy, useCallback, useState } from 'react'
import { FleetList } from './components/FleetList'
import { IncidentsPanel } from './components/IncidentsPanel'
import { RobotCharts } from './components/RobotCharts'
import { YardMap } from './components/YardMap'
import { useFleet } from './useFleet'
import { useTrails } from './useTrails'

// three is large, so the 3D view loads only when someone switches to it.
const Yard3D = lazy(() => import('./components/Yard3D').then((m) => ({ default: m.Yard3D })))
// 'to3d' and 'to2d' are the animated switches (decisions log: View transition): the 2D map stays
// mounted underneath while the 3D canvas flies in over it, or out of it.
type View = '2d' | 'to3d' | '3d' | 'to2d'

export function App() {
  const { robots, connected, epoch, subscribeTelemetry, subscribeIncident } = useFleet()
  const [selected, setSelected] = useState<string | null>(null)
  const [view, setView] = useState<View>('2d')
  const list = Object.values(robots).sort((a, b) => a.robot_id.localeCompare(b.robot_id))
  const trails = useTrails(subscribeTelemetry, list)
  const busy = view === 'to3d' || view === 'to2d'
  const shownAs = view === '2d' || view === 'to2d' ? '2d' : '3d'
  const pick = (v: '2d' | '3d') => {
    if (busy || v === shownAs) return
    setView(v === '3d' ? 'to3d' : 'to2d')
  }
  const onTransitionEnd = useCallback(() => setView((v) => (v === 'to3d' ? '3d' : v === 'to2d' ? '2d' : v)), [])

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <h1>Herdbook</h1>
            <span className="muted">Fleet operations</span>
          </div>
          <span className={connected ? 'live on' : 'live off'}>
            <i className="dot" />
            {connected ? 'Live' : 'Disconnected'}
          </span>
        </div>
      </header>
      <main>
        {/* Without this, every robot would freeze while still looking online (decisions log). */}
        {!connected && (
          <div className="banner" role="alert">
            Live connection lost: robot positions and status are not updating. Reconnecting…
          </div>
        )}
        <div className="top">
          <section className="panel map-panel">
            <div className="panel-head">
              <h2>Yard</h2>
              <div className="view-toggle" role="group" aria-label="Map view">
                {(['2d', '3d'] as const).map((v) => (
                  <button key={v} type="button" aria-pressed={shownAs === v} disabled={busy} onClick={() => pick(v)}>
                    {v.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
            <div className="map-stage">
              {view !== '3d' && <YardMap robots={list} selected={selected} onSelect={setSelected} trails={trails} />}
              {view !== '2d' && (
                // Same element in every 3D state, so the canvas never remounts mid-switch; only the
                // overlay class changes. While the 3D chunk loads, the 2D map simply stays visible.
                <div className={busy ? 'map-layer overlay' : 'map-layer'}>
                  <Suspense fallback={null}>
                    <Yard3D
                      robots={list}
                      selected={selected}
                      onSelect={setSelected}
                      trails={trails}
                      transition={view === 'to3d' ? 'in' : view === 'to2d' ? 'out' : null}
                      onTransitionEnd={onTransitionEnd}
                    />
                  </Suspense>
                </div>
              )}
            </div>
          </section>
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
