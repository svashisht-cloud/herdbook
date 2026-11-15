import { useCallback, useEffect, useState } from 'react'
import { formatRoute, parseRoute, type Route } from './route'

/**
 * The current hash route and a navigate() that patches it (decisions log: Hash routes). Page changes
 * push a history entry, so back/forward move between pages; `replace` (robot selection, map view) edits
 * the current entry, so clicking around the map doesn't fill the history.
 */
export function useRoute() {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash))

  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  const navigate = useCallback((patch: Partial<Route>, opts: { replace?: boolean } = {}) => {
    const next = formatRoute({ ...parseRoute(window.location.hash), ...patch })
    if (next === window.location.hash) return
    if (opts.replace) {
      window.history.replaceState(null, '', next) // replaceState doesn't fire hashchange
      setRoute(parseRoute(next))
    } else {
      window.location.hash = next
    }
  }, [])

  return { route, navigate }
}
