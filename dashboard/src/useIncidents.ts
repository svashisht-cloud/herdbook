import { useEffect, useState } from 'react'
import type { Incident } from './types'
import { useNow } from './useNow'

const WINDOW_MS = 24 * 60 * 60 * 1000 // the dashboard shows the last 24 h (decisions log)

/** Merge by id. Status moves forward only: a `recording` never replaces a `ready`. */
function merge(prev: Map<number, Incident>, incoming: Incident[]) {
  const next = new Map(prev)
  for (const i of incoming) {
    const cur = next.get(i.id)
    if (cur?.status === 'ready' && i.status !== 'ready') continue
    next.set(i.id, i)
  }
  return next
}

/**
 * The last 24 h of incidents, newest first: GET /api/incidents on every (re)connect (`epoch`) plus live
 * /ws updates. One instance in App feeds both the KPI bar and the Incidents page.
 */
export function useIncidents(epoch: number, subscribeIncident: (fn: (i: Incident) => void) => () => void) {
  const [incidents, setIncidents] = useState(new Map<number, Incident>())
  const [error, setError] = useState<string | null>(null)
  const now = useNow()

  useEffect(() => subscribeIncident((i) => setIncidents((prev) => merge(prev, [i]))), [subscribeIncident])

  useEffect(() => {
    let cancelled = false
    fetch('/api/incidents')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<Incident[]>
      })
      .then((list) => {
        if (cancelled) return
        setError(null)
        setIncidents((prev) => merge(prev, list))
      })
      .catch((err) => {
        if (!cancelled) setError(`Couldn't load incidents: ${err.message}`)
      })
    return () => {
      cancelled = true
    }
  }, [epoch])

  const rows = [...incidents.values()]
    .filter((i) => i.event_ts >= now - WINDOW_MS)
    .sort((a, b) => b.event_ts - a.event_ts || b.id - a.id)

  return { rows, error, setError }
}
