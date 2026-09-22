/**
 * The icon set.
 *
 * Hand-drawn rather than pulled from a package: seven glyphs do not justify a
 * dependency, and these need to sit at 13-14px against a dark palette, which is
 * smaller than most icon sets are drawn for.
 *
 * Stroke-based on a 24px grid at width 2, so they stay consistent with each
 * other and scale by changing one number. `currentColor` throughout, so a
 * button's hover and disabled states carry the icon with them.
 */

export type IconName =
  | 'link'
  | 'duplicate'
  | 'trash'
  | 'branch'
  | 'compare'
  | 'run'
  | 'rerun'
  | 'stop'

const PATHS: Record<IconName, React.ReactNode> = {
  link: (
    <>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </>
  ),
  duplicate: (
    <>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </>
  ),
  branch: (
    <>
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </>
  ),
  compare: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="12" y1="3" x2="12" y2="21" />
    </>
  ),
  run: <polygon points="6 3 20 12 6 21 6 3" />,
  rerun: (
    <>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </>
  ),
  stop: <rect x="6" y="6" width="12" height="12" rx="1.5" />,
}

export function Icon({
  name,
  size = 13,
  filled = false,
}: {
  name: IconName
  size?: number
  filled?: boolean
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      // Decorative: the button that owns it carries the accessible name.
      aria-hidden="true"
      focusable="false"
      className="shrink-0"
    >
      {PATHS[name]}
    </svg>
  )
}
