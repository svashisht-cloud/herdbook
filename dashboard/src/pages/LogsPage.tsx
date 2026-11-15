/** Placeholder until robot logs are built (Planned in ARCHITECTURE.md: live logs from /rosout). */
export function LogsPage() {
  return (
    <section className="panel empty-state">
      <h2>Logs</h2>
      <p className="hint">
        Live robot logs are next: every node's <code>/rosout</code> forwarded by edge_agent, with WARN and above
        kept through outages, and filters by robot, level and text.
      </p>
    </section>
  )
}
