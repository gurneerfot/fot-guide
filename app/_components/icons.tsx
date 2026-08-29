/**
 * The project's icon set.
 *
 * Hand-rolled rather than pulled from a library: six glyphs do not justify a
 * dependency, and every one here shares the same 24px box, 1.75 stroke and
 * round joins so they sit together without looking borrowed from three places.
 *
 * They take colour from `currentColor` and size from a `className`, so a caller
 * styles them exactly like text.
 */

type IconProps = { className?: string }

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
} as const

/** Delivered by a person — the badge on a mock test or a lesson plan. */
export function IconTeam({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20" />
      <circle cx="10" cy="7.5" r="3.25" />
      <path d="M20 20v-1.5a3.5 3.5 0 0 0-2.6-3.38M15.4 4.62a3.25 3.25 0 0 1 0 5.76" />
    </svg>
  )
}

/** Hosted material — the badge on anything readable here. */
export function IconBook({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M12 6.5S10.2 5 6.75 5H4v12.5h2.75C10.2 17.5 12 19 12 19s1.8-1.5 5.25-1.5H20V5h-2.75C13.8 5 12 6.5 12 6.5Z" />
      <path d="M12 6.5V19" />
    </svg>
  )
}

export function IconCheck({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  )
}

export function IconClose({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

export function IconMenu({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  )
}

/** The empty order panel. */
export function IconBag({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M5.5 8h13l-1.1 11.1a1.5 1.5 0 0 1-1.5 1.4H8.1a1.5 1.5 0 0 1-1.5-1.4L5.5 8Z" />
      <path d="M9 10V6.75a3 3 0 1 1 6 0V10" />
    </svg>
  )
}

/** Sits beside the payment reassurance line. */
export function IconLock({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="4.75" y="10.5" width="14.5" height="9.25" rx="2" />
      <path d="M8.25 10.5V7.75a3.75 3.75 0 1 1 7.5 0v2.75" />
    </svg>
  )
}

/**
 * WhatsApp. The one filled glyph in the set — the mark is recognised by its
 * silhouette, and outlining it would make it read as a generic speech bubble.
 */
export function IconWhatsApp({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden focusable="false" className={className}>
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 18.15h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24a8.2 8.2 0 0 1 5.83 2.42 8.2 8.2 0 0 1 2.41 5.83c0 4.54-3.7 8.23-8.24 8.23Zm4.52-6.17c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.24-.64.8-.78.97-.15.16-.29.18-.53.06-.25-.13-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.5.11-.11.25-.29.37-.44.13-.15.17-.25.25-.42.09-.16.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.43h-.47c-.17 0-.43.06-.66.31-.22.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.47-.07 1.47-.6 1.68-1.18.2-.58.2-1.08.15-1.18-.06-.11-.23-.17-.48-.29Z" />
    </svg>
  )
}
