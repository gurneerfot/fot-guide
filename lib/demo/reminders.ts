import { and, eq, gt, isNull, lt, sql } from 'drizzle-orm'
import { db, demoBookings, demoSlots } from '@/db'
import { sendDemoReminder } from './email'

/**
 * "Your demo class starts in an hour" — one email per booking.
 *
 * Handed to Resend ahead of time with a delivery time, so nothing on our side
 * has to be awake at the right moment: serverless functions are not, and
 * Vercel's free plan runs scheduled jobs only once a day. Resend accepts a
 * delivery time at most 30 days out, so a booking further ahead than that is
 * picked up later by the daily job (`/api/cron/demo-reminders`), which also
 * catches any booking whose scheduling failed the first time.
 */

export const REMINDER_LEAD_MINUTES = 60
/** A day of margin under Resend's 30-day limit. */
const MAX_AHEAD_MS = 29 * 24 * 60 * 60_000
/** A reminder due within this is pointless — they booked moments ago. */
const MIN_AHEAD_MS = 5 * 60_000

export function reminderTime(startsAt: Date): Date {
  return new Date(startsAt.getTime() - REMINDER_LEAD_MINUTES * 60_000)
}

export type ReminderOutcome = 'scheduled' | 'too-soon' | 'too-far' | 'failed' | 'already-scheduled'

export async function scheduleReminder(booking: {
  id: string
  name: string
  email: string
  timeZone: string
  startsAt: Date
  meetUrl: string
}): Promise<ReminderOutcome> {
  const at = reminderTime(booking.startsAt)
  const ahead = at.getTime() - Date.now()
  if (ahead < MIN_AHEAD_MS) return 'too-soon'
  if (ahead > MAX_AHEAD_MS) return 'too-far'

  const result = await sendDemoReminder({ ...booking, scheduledAt: at })
  if (!result.sent || !result.id) return 'failed'

  // Only if no reminder is recorded yet: the booking request and the daily job
  // can both get here for the same booking, and one person gets one email.
  const claimed = await db
    .update(demoBookings)
    .set({ reminderEmailId: result.id })
    .where(and(eq(demoBookings.id, booking.id), isNull(demoBookings.reminderEmailId)))
    .returning({ id: demoBookings.id })
  if (claimed.length === 0) {
    await cancelReminder(result.id).catch(() => {})
    return 'already-scheduled'
  }
  return 'scheduled'
}

/**
 * Stops a scheduled reminder. Resend can refuse a cancel for a few seconds
 * after scheduling while it is still processing the email, so this retries.
 */
export async function cancelReminder(emailId: string): Promise<void> {
  const key = process.env.RESEND_API_KEY
  if (!key) return
  let last = ''
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 2000 * attempt))
    const response = await fetch(`https://api.resend.com/emails/${encodeURIComponent(emailId)}/cancel`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}` },
    })
    // 404: nothing to cancel. Already sent or already cancelled also land here
    // as a 4xx, and neither can be undone by retrying.
    if (response.ok || response.status === 404) return
    last = `${response.status} ${await response.text()}`
  }
  throw new Error(`Resend would not cancel reminder ${emailId}: ${last}`)
}

/** The daily job: every upcoming booking that should have a reminder and does not. */
export async function scheduleDueReminders(): Promise<Record<ReminderOutcome, number>> {
  const counts: Record<ReminderOutcome, number> = {
    scheduled: 0,
    'too-soon': 0,
    'too-far': 0,
    failed: 0,
    'already-scheduled': 0,
  }
  const due = await db
    .select({
      id: demoBookings.id,
      name: demoBookings.name,
      email: demoBookings.email,
      timeZone: demoBookings.timeZone,
      startsAt: demoSlots.startsAt,
      meetUrl: demoSlots.meetUrl,
    })
    .from(demoBookings)
    .innerJoin(demoSlots, eq(demoSlots.id, demoBookings.slotId))
    .where(
      and(
        isNull(demoBookings.reminderEmailId),
        gt(demoSlots.startsAt, sql`now() + make_interval(mins => ${REMINDER_LEAD_MINUTES + 5})`),
        lt(demoSlots.startsAt, new Date(Date.now() + MAX_AHEAD_MS)),
      ),
    )

  for (const booking of due) {
    if (!booking.meetUrl) continue
    const outcome = await scheduleReminder({ ...booking, meetUrl: booking.meetUrl }).catch((error) => {
      console.error('[demo] reminder scheduling failed for', booking.id, error)
      return 'failed' as const
    })
    counts[outcome]++
  }
  return counts
}
