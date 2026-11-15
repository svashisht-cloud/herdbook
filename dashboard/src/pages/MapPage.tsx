import { Suspense, lazy } from 'react'
import { FleetList } from '../components/FleetList'
import { RobotCharts } from '../components/RobotCharts'
import { YardMap } from '../components/YardMap'
import type { MapView } from '../route'
import type { Robot, Telemetry } from '../types'
import type { Tracks } from '../useTracks'
import type { Trails } from '../useTrails'

// three is large, so the 3D view loads only when someone switches to it.
const Yard3D = lazy(() => import('../components/Yard3D').then((m) => ({ default: m.Yard3D })))

// 'to3d' and 'to2d' are the animated switches (decisions log: View transition): the 2D map stays
// mounted underneath while the 3D canvas flies in over it, or out of it.
export type ViewState = '2d' | 'to3d' | '3d' | 'to2d'

interface Props {
  robots: Robot[]
  selected: string | null
  onSelect: (id: string | null) => void
  view: ViewState
  onPickView: (v: MapView) => void
  onTransitionEnd: () => void
  trails: Trails
  tracks: Tracks
  epoch: number
  subscribeTelemetry: (fn: (t: Telemetry) => void) => () => void
}

export function MapPage({ robots, selected, onSelect, view, onPickView, onTransitionEnd, trails, tracks, epoch, subscribeTelemetry }: Props) {
  const busy = view === 'to3d' || view === 'to2d'
  const shownAs: MapView = view === '2d' || view === 'to2d' ? '2d' : '3d'
  return (
    <>
      <div className="top">
        <section className="panel map-panel">
          <div className="panel-head">
            <h2>Floor</h2>
            <div className="view-toggle" role="group" aria-label="Map view">
              {(['2d', '3d'] as const).map((v) => (
                <button key={v} type="button" aria-pressed={shownAs === v} disabled={busy} onClick={() => onPickView(v)}>
                  {v.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <div className="map-stage">
            {view !== '3d' && <YardMap robots={robots} selected={selected} onSelect={onSelect} trails={trails} tracks={tracks} />}
            {view !== '2d' && (
              // Same element in every 3D state, so the canvas never remounts mid-switch; only the
              // overlay class changes. While the 3D chunk loads, the 2D map simply stays visible.
              <div className={busy ? 'map-layer overlay' : 'map-layer'}>
                <Suspense fallback={null}>
                  <Yard3D
                    robots={robots}
                    selected={selected}
                    onSelect={onSelect}
                    trails={trails}
                    tracks={tracks}
                    transition={view === 'to3d' ? 'in' : view === 'to2d' ? 'out' : null}
                    onTransitionEnd={onTransitionEnd}
                  />
                </Suspense>
              </div>
            )}
          </div>
        </section>
        <FleetList robots={robots} selected={selected} onSelect={onSelect} />
      </div>
      {selected ? (
        <RobotCharts robotId={selected} epoch={epoch} subscribeTelemetry={subscribeTelemetry} />
      ) : (
        <p className="hint">Click a robot on the map or in the list to see its speed and battery.</p>
      )}
    </>
  )
}
