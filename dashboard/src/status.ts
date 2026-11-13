import type { Status } from './types'

// Color comes from status only; the dashboard never guesses (decisions log).
export const STATUS_COLOR: Record<Status, string> = {
  online: '#1f9d55',
  degraded: '#e0a000',
  offline: '#9aa0a6',
}

/** Both views use this: offline grey, degraded amber, online green. */
export function statusColor(status: Status): string {
  return STATUS_COLOR[status]
}
