import type { Incident } from '../types'

const fmtTime = (ts: number) => new Date(ts).toLocaleString()
const fmtSize = (b: number | null) => (b == null ? '—' : `${(b / 1e6).toFixed(1)} MB`)

interface Props {
  rows: Incident[] // last 24 h, newest first (useIncidents)
  error: string | null
  onError: (message: string) => void
}

export function IncidentsPanel({ rows, error, onError }: Props) {
  const download = async (id: number) => {
    try {
      const res = await fetch(`/api/incidents/${id}/download`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const { url } = (await res.json()) as { url: string }
      window.location.assign(url)
    } catch (err) {
      onError(`Download failed: ${(err as Error).message}`)
    }
  }

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
