import { useState } from 'react'
import { FleetList } from './components/FleetList'
import { IncidentsPanel } from './components/IncidentsPanel'
import { RobotCharts } from './components/RobotCharts'
import { YardMap } from './components/YardMap'
import { useFleet } from './useFleet'

export function App() {
  const { robots, connected, epoch, subscribeTelemetry, subscribeIncident } = useFleet()
  const [selected, setSelected] = useState<string | null>(null)
  const list = Object.values(robots).sort((a, b) => a.robot_id.localeCompare(b.robot_id))

  return (
    <div className="app">
      <header>
        <h1>Herdbook</h1>
        <span className={connected ? 'live on' : 'live off'}>{connected ? 'live' : 'disconnected'}</span>
      </header>
      {/* Without this, every robot would freeze while still looking online (decisions log). */}
      {!connected && (
        <div className="banner" role="alert">
          Live connection lost: robot positions and status are not updating. Reconnecting…
        </div>
      )}
      <main>
        <div className="top">
          <YardMap robots={list} selected={selected} onSelect={setSelected} />
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
