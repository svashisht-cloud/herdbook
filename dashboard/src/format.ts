// Small display formatters shared by the fleet list, KPI bar and robot cards.

/** "4s ago", "3m ago", "2h ago". */
export function ago(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}

/** A 0..1 fraction as a whole percent, or an em dash when unknown. */
export const pct = (f: number | null | undefined): string => (f == null ? '—' : `${Math.round(f * 100)}%`)
