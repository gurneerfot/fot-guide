/**
 * Demo slots are stored as instants and shown as wall-clock time in whoever is
 * looking's own zone. Nothing here does arithmetic on local times — that is
 * where daylight saving bites — it only formats an instant for a named zone.
 */

export const SLOT_MINUTES = 30
/** What a new slot offers unless the owner says otherwise. */
export const DEFAULT_SEATS = 2
/** Matches the `demo_slots_capacity_range` check. */
export const MAX_SEATS = 50
/** No booking a call that starts before the owner could reasonably see it. */
export const BOOKING_CUTOFF_MINUTES = 60
/** How far ahead the public page looks. */
export const BOOKING_HORIZON_DAYS = 60

/** Where the owner is. Their emails are written in this zone. */
export function adminTimeZone(): string {
  return safeTimeZone(process.env.ADMIN_TIME_ZONE) ?? 'Asia/Kolkata'
}

/** A real IANA zone name, or null. Untrusted input from the browser goes through this. */
export function safeTimeZone(value: string | null | undefined): string | null {
  if (!value || value.length > 64) return null
  try {
    new Intl.DateTimeFormat('en', { timeZone: value })
    return value
  } catch {
    return null
  }
}

export function slotEnd(startsAt: Date): Date {
  return new Date(startsAt.getTime() + SLOT_MINUTES * 60_000)
}

/** "Tuesday 14 October 2026, 7:00 pm – 7:30 pm India Standard Time" */
export function formatSlot(startsAt: Date, timeZone: string): string {
  const day = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(startsAt)
  const time = (at: Date, withZone: boolean) =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      ...(withZone ? { timeZoneName: 'long' as const } : {}),
    }).format(at)
  return `${day}, ${time(startsAt, false)} – ${time(slotEnd(startsAt), true)}`
}
