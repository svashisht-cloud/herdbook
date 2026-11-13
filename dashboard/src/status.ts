import { THEME } from './theme'
import type { Status } from './types'

// Color comes from status only; the dashboard never guesses (decisions log). Values live in THEME.
export const STATUS_COLOR: Record<Status, string> = THEME.color.status

/** Both views use this for robots, rings and trails: offline grey, degraded amber, online green. */
export function statusColor(status: Status): string {
  return STATUS_COLOR[status]
}
