// Line icons for the sidebar, drawn inline (no icon library). 24 x 24 viewBox, stroked in currentColor.

const PATHS = {
  map: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Zm0 0v14m6-12v14',
  robots: 'M7 8h10a3 3 0 0 1 3 3v4a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-4a3 3 0 0 1 3-3Zm5-4v4M9 13h.01M15 13h.01',
  incidents: 'M12 3 2 20h20L12 3Zm0 6v5m0 3h.01',
  logs: 'M4 5h16M4 10h10M4 15h16M4 20h8',
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  )
}
