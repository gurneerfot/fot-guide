import { and, asc, count, eq, gt, gte, lt, sql } from 'drizzle-orm'
import { db, demoBookings, demoSlots } from '@/db'
import { BOOKING_CUTOFF_MINUTES, BOOKING_HORIZON_DAYS, SLOT_MINUTES, slotEnd } from './time'
import {
  createDemoEvent,
  deleteDemoEvent,
  eventConference,
  type Conference,
} from './google'
import { cancelReminder } from './reminders'

/**
 * Everything that reaches outside the database, passed in so the booking
 * rules can be exercised against a stand-in calendar (`pnpm check:demo`)
 * without creating real events or emailing anyone.
 */
export type DemoDeps = {
  createEvent: typeof createDemoEvent
  deleteEvent: typeof deleteDemoEvent
  eventConference: typeof eventConference
  cancelReminder: typeof cancelReminder
}

export const liveDeps: DemoDeps = {
  createEvent: createDemoEvent,
  deleteEvent: deleteDemoEvent,
  eventConference,
  cancelReminder,
}

/* ------------------------------------------------------------- public -- */

export type OpenSlot = { id: string; startsAt: Date; capacity: number; seatsLeft: number }

/**
 * What the public page lists: bookable slots only. Full slots stay in the list
 * as "full" so a visitor can see the calendar is real, not empty.
 */
export async function listBookableSlots(): Promise<OpenSlot[]> {
  const from = new Date(Date.now() + BOOKING_CUTOFF_MINUTES * 60_000)
  const until = new Date(Date.now() + BOOKING_HORIZON_DAYS * 24 * 60 * 60_000)

  const rows = await db
    .select({
      id: demoSlots.id,
      startsAt: demoSlots.startsAt,
      capacity: demoSlots.capacity,
      taken: count(demoBookings.id),
    })
    .from(demoSlots)
    .leftJoin(demoBookings, eq(demoBookings.slotId, demoSlots.id))
    .where(and(gt(demoSlots.startsAt, from), lt(demoSlots.startsAt, until)))
    .groupBy(demoSlots.id)
    .orderBy(asc(demoSlots.startsAt))

  return rows.map((r) => ({
    id: r.id,
    startsAt: r.startsAt,
    capacity: r.capacity,
    seatsLeft: Math.max(0, r.capacity - Number(r.taken)),
  }))
}

export type BookingInput = {
  slotId: string
  name: string
  email: string
  phone: string
  levelNote: string
  timeZone: string
  ip: string | null
}

export type BookingResult =
  | { status: 'booked'; bookingId: string; seat: number; capacity: number; startsAt: Date; meetUrl: string }
  | { status: 'not-found' }
  | { status: 'closed' }
  | { status: 'full' }
  | { status: 'already-in-slot' }
  | { status: 'already-booked'; startsAt: Date }
  | { status: 'calendar-failed'; reason: string }

type LockedSlot = {
  id: string
  starts_at: Date | string
  capacity: number
  meet_conference: Conference | null
  google_event_id: string | null
}

/** Thrown inside the transaction so it rolls back; caught just outside it. */
class CalendarFailed extends Error {}

/**
 * Takes a seat and puts it on both calendars, or says why not.
 *
 * `FOR UPDATE` on the slot row makes every booking for one slot wait its turn,
 * so two people racing for the last seat are decided one after the other
 * rather than both reading "one left". The unique `(slot_id, seat)` index and
 * the seat-within-capacity trigger are the backstop if that ever stops being
 * true.
 *
 * The calendar event is made while that lock is held. That is what lets the
 * first two bookers of a slot arrive at the same moment and still end up in
 * one Meet call: the second waits, then finds the call the first one started.
 * If Google fails, the whole booking rolls back — a seat with no way to join
 * the class is worse than "please try again".
 */
export async function bookSeat(input: BookingInput, deps: DemoDeps = liveDeps): Promise<BookingResult> {
  let createdEventId: string | null = null
  try {
    return await db.transaction(async (tx) => {
      const locked = await tx.execute(
        sql`select id, starts_at, capacity, meet_conference, google_event_id
            from demo_slots where id = ${input.slotId} for update`,
      )
      const slot = locked.rows[0] as LockedSlot | undefined
      if (!slot) return { status: 'not-found' as const }

      const startsAt = new Date(slot.starts_at)
      if (startsAt.getTime() <= Date.now() + BOOKING_CUTOFF_MINUTES * 60_000) {
        return { status: 'closed' as const }
      }

      const taken = await tx
        .select({ seat: demoBookings.seat, email: demoBookings.email })
        .from(demoBookings)
        .where(eq(demoBookings.slotId, slot.id))

      const email = input.email.toLowerCase()
      if (taken.some((b) => b.email.toLowerCase() === email)) {
        return { status: 'already-in-slot' as const }
      }

      // The lowest free seat, not `count + 1`: if the owner removed seat 1,
      // the next booker takes seat 1 rather than colliding with seat 2.
      const seat = Array.from({ length: slot.capacity }, (_, i) => i + 1).find(
        (n) => !taken.some((b) => b.seat === n),
      )
      if (!seat) return { status: 'full' as const }

      // One upcoming demo per person. Someone wanting a second is better
      // served by a message than by quietly holding two seats others could use.
      const [other] = await tx
        .select({ startsAt: demoSlots.startsAt })
        .from(demoBookings)
        .innerJoin(demoSlots, eq(demoSlots.id, demoBookings.slotId))
        .where(and(sql`lower(${demoBookings.email}) = ${email}`, gt(demoSlots.startsAt, new Date())))
        .limit(1)
      if (other) return { status: 'already-booked' as const, startsAt: other.startsAt }

      const [row] = await tx
        .insert(demoBookings)
        .values({
          slotId: slot.id,
          seat,
          name: input.name,
          email: input.email,
          phone: input.phone,
          levelNote: input.levelNote,
          timeZone: input.timeZone,
          ip: input.ip,
        })
        .returning({ id: demoBookings.id })

      // The slot's call: already started by an earlier booking, held by the
      // one slot-wide event of a slot planned before this change, or — for
      // the first booking — none yet, in which case this event starts it.
      let event
      try {
        let conference = slot.meet_conference
        if (!conference && slot.google_event_id) conference = await deps.eventConference(slot.google_event_id)
        event = await deps.createEvent({
          requestId: row.id,
          startsAt,
          endsAt: slotEnd(startsAt),
          summary: `Français on Tips — free demo class (${input.name})`,
          description:
            'Your free 30-minute French demo class with Français on Tips. Join with the Google Meet link on this invitation.',
          attendee: { email: input.email, name: input.name },
          conference,
        })
      } catch (error) {
        throw new CalendarFailed(error instanceof Error ? error.message : String(error))
      }
      createdEventId = event.eventId

      await tx.update(demoBookings).set({ googleEventId: event.eventId }).where(eq(demoBookings.id, row.id))
      if (!slot.meet_conference) {
        await tx
          .update(demoSlots)
          .set({ meetConference: event.conference, meetUrl: event.meetUrl })
          .where(eq(demoSlots.id, slot.id))
      }

      return {
        status: 'booked' as const,
        bookingId: row.id,
        seat,
        capacity: slot.capacity,
        startsAt,
        meetUrl: event.meetUrl,
      }
    })
  } catch (error) {
    if (error instanceof CalendarFailed) {
      console.error('[demo] booking rolled back: calendar event failed —', error.message)
      return { status: 'calendar-failed', reason: error.message }
    }
    // The event exists but the booking did not commit: take the invite back.
    if (createdEventId) await deps.deleteEvent(createdEventId, { notify: true }).catch(() => {})
    // 23505 / 23514: a unique index or the capacity trigger said no — the lock
    // was bypassed somehow, and the schema did its job. To the booker it means
    // the same thing as full.
    if (hasCode(error, '23505') || hasCode(error, '23514')) return { status: 'full' }
    throw error
  }
}

function hasCode(error: unknown, code: string): boolean {
  for (let e = error as { code?: string; cause?: unknown } | undefined; e; e = e.cause as typeof e) {
    if (e.code === code) return true
  }
  return false
}

/** Crude but database-backed, so it holds across serverless instances. */
export async function bookingsFromIpToday(ip: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(demoBookings)
    .where(and(eq(demoBookings.ip, ip), gte(demoBookings.createdAt, new Date(Date.now() - 86_400_000))))
  return row?.n ?? 0
}

/* -------------------------------------------------------------- admin -- */

export async function listSlotsForAdmin() {
  // Two weeks back so the owner can still see who came to a recent call.
  const now = Date.now()
  const slots = await db.query.demoSlots.findMany({
    where: gte(demoSlots.startsAt, new Date(now - 14 * 24 * 60 * 60_000)),
    orderBy: asc(demoSlots.startsAt),
    with: { bookings: { orderBy: asc(demoBookings.seat) } },
  })
  return {
    upcoming: slots.filter((s) => s.startsAt.getTime() > now),
    // Most recent first: yesterday's call is the one being looked up.
    past: slots.filter((s) => s.startsAt.getTime() <= now).reverse(),
  }
}

export type CreateSlotResult = { status: 'created'; id: string } | { status: 'overlaps' }

/**
 * Database only. Nothing goes on anyone's calendar until a person books, so
 * a month of open slots does not fill the owner's calendar with empty events.
 */
export async function createSlot(input: { startsAt: Date; capacity: number }): Promise<CreateSlotResult> {
  // One owner, one call at a time: no slot may start within 30 minutes of another.
  const window = SLOT_MINUTES * 60_000
  const [clash] = await db
    .select({ id: demoSlots.id })
    .from(demoSlots)
    .where(
      and(
        gt(demoSlots.startsAt, new Date(input.startsAt.getTime() - window)),
        lt(demoSlots.startsAt, new Date(input.startsAt.getTime() + window)),
      ),
    )
    .limit(1)
  if (clash) return { status: 'overlaps' }

  try {
    const [row] = await db
      .insert(demoSlots)
      .values({ startsAt: input.startsAt, capacity: input.capacity })
      .returning({ id: demoSlots.id })
    return { status: 'created', id: row.id }
  } catch (error) {
    if (hasCode(error, '23505')) return { status: 'overlaps' }
    throw error
  }
}

export type DeleteSlotResult = { status: 'deleted' } | { status: 'has-bookings' } | { status: 'not-found' }

/** Empty slots only. A booked one has people expecting a call. */
export async function deleteSlot(id: string, deps: DemoDeps = liveDeps): Promise<DeleteSlotResult> {
  const result = await db.transaction(async (tx) => {
    const locked = await tx.execute(
      sql`select id, google_event_id from demo_slots where id = ${id} for update`,
    )
    const slot = locked.rows[0] as { id: string; google_event_id: string | null } | undefined
    if (!slot) return { status: 'not-found' as const }

    const [booked] = await tx
      .select({ n: count() })
      .from(demoBookings)
      .where(eq(demoBookings.slotId, id))
    if ((booked?.n ?? 0) > 0) return { status: 'has-bookings' as const }

    await tx.delete(demoSlots).where(eq(demoSlots.id, id))
    return { status: 'deleted' as const, googleEventId: slot.google_event_id }
  })

  // Only slots planned before this change carry a slot-wide event.
  if (result.status === 'deleted' && result.googleEventId) {
    await deps.deleteEvent(result.googleEventId, { notify: false }).catch((error) =>
      console.error('[demo] slot deleted but its calendar event was not', error),
    )
  }
  return result.status === 'deleted' ? { status: 'deleted' } : result
}

/**
 * For junk or a booker who asked to be taken off. Frees the seat, takes the
 * event off both calendars (Google tells the booker it was cancelled) and
 * cancels their reminder. The slot keeps its call for whoever books next.
 */
export async function deleteBooking(id: string, deps: DemoDeps = liveDeps): Promise<boolean> {
  const [removed] = await db
    .delete(demoBookings)
    .where(eq(demoBookings.id, id))
    .returning({ googleEventId: demoBookings.googleEventId, reminderEmailId: demoBookings.reminderEmailId })
  if (!removed) return false

  if (removed.googleEventId) {
    await deps
      .deleteEvent(removed.googleEventId, { notify: true })
      .catch((error) => console.error('[demo] booking removed but its calendar event was not', error))
  }
  if (removed.reminderEmailId) {
    await deps
      .cancelReminder(removed.reminderEmailId)
      .catch((error) => console.error('[demo] booking removed but its reminder was not cancelled', error))
  }
  return true
}
