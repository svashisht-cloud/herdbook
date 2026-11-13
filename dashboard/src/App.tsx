import { useState } from 'react'
import { FleetList } from './components/FleetList'
import { RobotCharts } from './components/RobotCharts'
import { YardMap } from './components/YardMap'
import { useFleet } from './useFleet'

export function App() {
  const { robots, connected, subscribeTelemetry } = useFleet()
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
          <RobotCharts robotId={selected} subscribeTelemetry={subscribeTelemetry} />
        ) : (
          <p className="muted hint">Click a robot on the map or in the list to see its speed and battery.</p>
        )}
      </main>
    </div>
  )
}
