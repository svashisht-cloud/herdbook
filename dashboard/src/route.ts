// Hash routes (decisions log: Hash routes). The URL holds the page, the map view and the selected robot,
// so a link opens exactly that view and back/forward work. Pure parse/format; useRoute wires it up.
//
//   #/map?view=3d&robot=robot2   #/robots?robot=robot1   #/incidents   #/logs

export const PAGES = ['map', 'robots', 'incidents', 'logs'] as const
export type Page = (typeof PAGES)[number]
export type MapView = '2d' | '3d'

export interface Route {
  page: Page
  view: MapView
  robot: string | null
}

export const DEFAULT_ROUTE: Route = { page: 'map', view: '2d', robot: null }

/** Anything unknown falls back to the default, so a bad link still opens the dashboard. */
export function parseRoute(hash: string): Route {
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?')
  const page = (PAGES as readonly string[]).includes(path) ? (path as Page) : DEFAULT_ROUTE.page
  const params = new URLSearchParams(query)
  const view: MapView = params.get('view') === '3d' ? '3d' : '2d'
  const robot = params.get('robot') || null
  return { page, view, robot }
}

/** Only non-default params are written, so the common case stays a short URL. */
export function formatRoute(r: Route): string {
  const params = new URLSearchParams()
  if (r.view !== '2d') params.set('view', r.view)
  if (r.robot) params.set('robot', r.robot)
  const q = params.toString()
  return `#/${r.page}${q ? `?${q}` : ''}`
}
