import type { MouseEvent } from 'react'
import type { MapView, Page, Route } from '../route'
import { Icon, type IconName } from './Icon'

// App navigation (decisions log: App shell). Map keeps its 2D/3D toggle on the page, so the animated
// switch between them stays one page; the 2D / 3D links here open the map in that mode.
const ITEMS: { page: Page; label: string; icon: IconName; soon?: boolean }[] = [
  { page: 'map', label: 'Map', icon: 'map' },
  { page: 'robots', label: 'Robots', icon: 'robots' },
  { page: 'incidents', label: 'Incidents', icon: 'incidents' },
  { page: 'logs', label: 'Logs', icon: 'logs', soon: true },
]

interface Props {
  route: Route
  onNavigate: (patch: Partial<Route>) => void
  connected: boolean
  openIncidents: number
}

export function Sidebar({ route, onNavigate, connected, openIncidents }: Props) {
  const go = (page: Page, view?: MapView) => (e: MouseEvent) => {
    e.preventDefault()
    onNavigate(view ? { page, view } : { page })
  }
  return (
    <nav className="sidebar" aria-label="Main">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          ▣
        </span>
        <span className="brand-name">herdbook</span>
      </div>
      <ul className="nav">
        {ITEMS.map((it) => (
          <li key={it.page}>
            <a
              href={`#/${it.page}`}
              className={route.page === it.page ? 'nav-item active' : 'nav-item'}
              aria-current={route.page === it.page ? 'page' : undefined}
              onClick={go(it.page)}
            >
              <Icon name={it.icon} />
              <span className="nav-label">{it.label}</span>
              {it.page === 'incidents' && openIncidents > 0 && <span className="badge">{openIncidents}</span>}
              {it.soon && <span className="soon">soon</span>}
            </a>
            {it.page === 'map' && (
              <div className="nav-sub">
                {(['2d', '3d'] as const).map((v) => (
                  <a
                    key={v}
                    href={`#/map${v === '3d' ? '?view=3d' : ''}`}
                    className={route.page === 'map' && route.view === v ? 'active' : undefined}
                    onClick={go('map', v)}
                  >
                    {v.toUpperCase()}
                  </a>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
      <div className="sidebar-foot">
        <span className={connected ? 'live on' : 'live off'}>
          <i className="dot" />
          {connected ? 'live' : 'disconnected'}
        </span>
      </div>
    </nav>
  )
}
