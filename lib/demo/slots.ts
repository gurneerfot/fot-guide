import { and, asc, count, eq, gt, gte, lt, sql } from 'drizzle-orm'
import { db, demoBookings, demoSlots } from '@/db'
import {
  BOOKING_CUTOFF_MINUTES,
  BOOKING_HORIZON_DAYS,
  SEATS_PER_SLOT,
  SLOT_MINUTES,
  slotEnd,
} from './time'
import { createMeetEvent, deleteMeetEvent, googleConfigured } from './google'

/* ------------------------------------------------------------- public -- */

export type OpenSlot = { id: string; startsAt: Date; seatsLeft: number }

/**
 * What the public page lists: bookable slots only. Full slots stay in the list
 * as "full" so a visitor can see the calendar is real, not empty.
 */
export async function listBookableSlots(): Promise<OpenSlot[]> {
  const from = new Date(Date.now() + BOOKING_CUTOFF_MINUTES * 60_000)
  const until = new Date(Date.now() + BOOKING_HORIZON_DAYS * 24 * 60 * 60_000)

  const rows = await db
    .select({ id: demoSlots.id, startsAt: demoSlots.startsAt, taken: count(demoBookings.id) })
    .from(demoSlots)
    .leftJoin(demoBookings, eq(demoBookings.slotId, demoSlots.id))
    .where(and(gt(demoSlots.startsAt, from), lt(demoSlots.startsAt, until)))
    .groupBy(demoSlots.id)
    .orderBy(asc(demoSlots.startsAt))

  return rows.map((r) => ({
    id: r.id,
    startsAt: r.startsAt,
    seatsLeft: Math.max(0, SEATS_PER_SLOT - Number(r.taken)),
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
  | { status: 'booked'; bookingId: string; seat: number; startsAt: Date; meetUrl: string }
  | { status: 'not-found' }
  | { status: 'closed' }
  | { status: 'full' }
  | { status: 'already-in-slot' }
  | { status: 'already-booked'; startsAt: Date }

type LockedSlot = { id: string; starts_at: Date | string; meet_url: string }

/**
 * Takes a seat, or says why not.
 *
 * `FOR UPDATE` on the slot row makes every booking for one slot wait its turn,
 * so two people racing for the last seat are decided one after the other
 * rather than both reading "one left". The unique `(slot_id, seat)` index is
 * the backstop if that ever stops being true.
 */
export async function bookSeat(input: BookingInput): Promise<BookingResult> {
  try {
    return await db.transaction(async (tx) => {
      const locked = await tx.execute(
        sql`select id, starts_at, meet_url from demo_slots where id = ${input.slotId} for update`,
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
      const seat = Array.from({ length: SEATS_PER_SLOT }, (_, i) => i + 1).find(
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

      return { status: 'booked' as const, bookingId: row.id, seat, startsAt, meetUrl: slot.meet_url }
    })
  } catch (error) {
    // 23505: a unique index said no — the lock was bypassed somehow, and the
    // schema did its job. To the booker it means the same thing as full.
    if (isUniqueViolation(error)) return { status: 'full' }
    throw error
  }
}

function isUniqueViolation(error: unknown): boolean {
  for (let e = error as { code?: string; cause?: unknown } | undefined; e; e = e.cause as typeof e) {
    if (e.code === '23505') return true
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

export type CreateSlotResult =
  | { status: 'created'; id: string }
  | { status: 'overlaps' }
  | { status: 'needs-link' }

/**
 * Makes the Meet link first, then the row. A Google failure therefore leaves
 * nothing behind here, and it surfaces to the owner at the moment they can
 * retry — never to a visitor mid-booking.
 */
export async function createSlot(input: { startsAt: Date; meetUrl?: string }): Promise<CreateSlotResult> {
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

  const id = crypto.randomUUID()
  let meetUrl = input.meetUrl
  let googleEventId: string | null = null

  if (!meetUrl) {
    if (!googleConfigured()) return { status: 'needs-link' }
    const event = await createMeetEvent({ slotId: id, startsAt: input.startsAt, endsAt: slotEnd(input.startsAt) })
    meetUrl = event.meetUrl
    googleEventId = event.eventId
  }

  try {
    await db.insert(demoSlots).values({ id, startsAt: input.startsAt, meetUrl, googleEventId })
  } catch (error) {
    if (googleEventId) await deleteMeetEvent(googleEventId).catch(() => {})
    if (isUniqueViolation(error)) return { status: 'overlaps' }
    throw error
  }
  return { status: 'created', id }
}

export type DeleteSlotResult = { status: 'deleted' } | { status: 'has-bookings' } | { status: 'not-found' }

/** Empty slots only. A booked one has people expecting a call. */
export async function deleteSlot(id: string): Promise<DeleteSlotResult> {
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

  if (result.status === 'deleted' && result.googleEventId) {
    await deleteMeetEvent(result.googleEventId).catch((error) =>
      console.error('[demo] slot deleted but its calendar event was not', error),
    )
  }
  return result.status === 'deleted' ? { status: 'deleted' } : result
}

/** For junk or a booker who asked to be taken off. Frees the seat. */
export async function deleteBooking(id: string): Promise<boolean> {
  const removed = await db.delete(demoBookings).where(eq(demoBookings.id, id)).returning({ id: demoBookings.id })
  return removed.length > 0
}
