import { useEffect, useState } from 'react'
import type { Incident } from '../types'
import { useNow } from '../useNow'

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

const fmtTime = (ts: number) => new Date(ts).toLocaleString()
const fmtSize = (b: number | null) => (b == null ? '—' : `${(b / 1e6).toFixed(1)} MB`)

interface Props {
  epoch: number // goes up on every WebSocket (re)connect: refetch then
  subscribeIncident: (fn: (i: Incident) => void) => () => void
}

export function IncidentsPanel({ epoch, subscribeIncident }: Props) {
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

  const download = async (id: number) => {
    try {
      const res = await fetch(`/api/incidents/${id}/download`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const { url } = (await res.json()) as { url: string }
      window.location.assign(url)
    } catch (err) {
      setError(`Download failed: ${(err as Error).message}`)
    }
  }

  const rows = [...incidents.values()]
    .filter((i) => i.event_ts >= now - WINDOW_MS)
    .sort((a, b) => b.event_ts - a.event_ts || b.id - a.id)

  return (
    <section className="panel incidents">
      <h2>
        Incidents <span className="muted">last 24 hours · {rows.length}</span>
      </h2>
      {error && <p className="error">{error}</p>}
      {rows.length === 0 ? (
        <p className="muted">No incidents in the last 24 hours.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Robot</th>
              <th>Type</th>
              <th>Time</th>
              <th>Status</th>
              <th className="num">Size</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.id}>
                <td>{i.robot_id}</td>
                <td>{i.type}</td>
                <td>{fmtTime(i.event_ts)}</td>
                <td>
                  <span className="status">
                    <i className={`dot ${i.status}`} />
                    {i.status}
                  </span>
                </td>
                <td className="num">{fmtSize(i.size_bytes)}</td>
                <td>{i.status === 'ready' && <button onClick={() => void download(i.id)}>Download</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
