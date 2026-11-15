import { useCallback, useEffect, useState } from 'react'
import { IncidentsPanel } from './components/IncidentsPanel'
import { KpiBar } from './components/KpiBar'
import { Sidebar } from './components/Sidebar'
import { LogsPage } from './pages/LogsPage'
import { MapPage, type ViewState } from './pages/MapPage'
import { RobotsPage } from './pages/RobotsPage'
import type { MapView, Page } from './route'
import { useFleet } from './useFleet'
import { useIncidents } from './useIncidents'
import { useRoute } from './useRoute'
import { useTracks } from './useTracks'
import { useTrails } from './useTrails'
import { STAND_IN_YARD, YardContext } from './yard'
import { useYardMap } from './useYardMap'

const TITLES: Record<Page, string> = { map: 'Floor map', robots: 'Robots', incidents: 'Incidents', logs: 'Logs' }

// Layout (decisions log: App shell): sidebar, page header with the KPI bar, then the page. The route
// (decisions log: Hash routes) holds the page, the map view and the selected robot.
export function App() {
  const { robots, connected, epoch, subscribeTelemetry, subscribeIncident } = useFleet()
  const { route, navigate } = useRoute()
  const list = Object.values(robots).sort((a, b) => a.robot_id.localeCompare(b.robot_id))
  // Trails, tracks and incidents live here, not in a page, so they keep their history across pages.
  const trails = useTrails(subscribeTelemetry, list)
  const tracks = useTracks(subscribeTelemetry, list)
  const incidents = useIncidents(epoch, subscribeIncident)
  const yard = useYardMap()

  // The map view animates toward the route's view (decisions log: View transition). Off the map page
  // there is nothing to animate, so it just takes the route's value.
  const [view, setView] = useState<ViewState>(route.view)
  const busy = view === 'to3d' || view === 'to2d'
  useEffect(() => {
    if (route.page !== 'map') setView(route.view)
    else if (!busy && view !== route.view) setView(route.view === '3d' ? 'to3d' : 'to2d')
  }, [route.page, route.view, view, busy])
  const onTransitionEnd = useCallback(() => setView((v) => (v === 'to3d' ? '3d' : v === 'to2d' ? '2d' : v)), [])

  const select = useCallback((id: string | null) => navigate({ robot: id }, { replace: true }), [navigate])
  const pickView = (v: MapView) => navigate({ view: v }, { replace: true })
  const openIncidents = incidents.rows.filter((i) => i.status === 'recording').length

  return (
    <YardContext.Provider value={yard}>
      <div className="shell">
        <Sidebar route={route} onNavigate={(patch) => navigate(patch)} connected={connected} openIncidents={openIncidents} />
        <main>
          <header className="page-head">
            <h1>{TITLES[route.page]}</h1>
            <KpiBar robots={list} incidents={incidents.rows} connected={connected} />
          </header>
          {/* Without this, every robot would freeze while still looking online (decisions log). */}
          {!connected && (
            <div className="banner" role="alert">
              Live connection lost: robot positions and status are not updating. Reconnecting…
            </div>
          )}
          {yard.error && (
            <div className="banner" role="alert">
              Couldn't load the floor map: {yard.error} Showing the {STAND_IN_YARD.width} × {STAND_IN_YARD.height} m stand-in.
            </div>
          )}
          {route.page === 'map' && (
            <MapPage
              robots={list}
              selected={route.robot}
              onSelect={select}
              view={view}
              onPickView={pickView}
              onTransitionEnd={onTransitionEnd}
              trails={trails}
              tracks={tracks}
              epoch={epoch}
              subscribeTelemetry={subscribeTelemetry}
            />
          )}
          {route.page === 'robots' && (
            <RobotsPage
              robots={list}
              selected={route.robot}
              onSelect={select}
              onShowOnMap={(id) => navigate({ page: 'map', robot: id })}
              epoch={epoch}
              subscribeTelemetry={subscribeTelemetry}
            />
          )}
          {route.page === 'incidents' && (
            <IncidentsPanel rows={incidents.rows} error={incidents.error} onError={incidents.setError} />
          )}
          {route.page === 'logs' && <LogsPage />}
        </main>
      </div>
    </YardContext.Provider>
  )
}
