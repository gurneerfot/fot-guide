/**
 * One-off, after deploying per-booking calendar events:
 *
 *  1. Slots planned before that change each put an empty event on the owner's
 *     calendar. For every such slot nobody has booked, delete that event and
 *     clear its link, so the slot behaves like a newly planned one — nothing
 *     on the calendar until someone books. Booked slots keep their event: it
 *     holds the Meet call their bookers were already sent.
 *  2. Schedule the "starts in an hour" reminder for existing bookings.
 *
 *   pnpm demo:upgrade            # dry run: reports, changes nothing
 *   pnpm demo:upgrade --apply    # does it
 *
 * Runs against DATABASE_URL — production when run with `.env.local`. Safe to
 * re-run: slots already cleared and bookings already reminded are skipped.
 */
import { count, eq, isNotNull, sql } from 'drizzle-orm'
import { db, demoBookings, demoSlots } from '../db'
import { deleteDemoEvent } from '../lib/demo/google'
import { scheduleDueReminders } from '../lib/demo/reminders'

const apply = process.argv.includes('--apply')

async function main() {
  console.log(apply ? 'APPLYING\n' : 'DRY RUN — nothing will change. Re-run with --apply.\n')

  const legacy = await db
    .select({ id: demoSlots.id, startsAt: demoSlots.startsAt, bookings: count(demoBookings.id) })
    .from(demoSlots)
    .leftJoin(demoBookings, eq(demoBookings.slotId, demoSlots.id))
    .where(isNotNull(demoSlots.googleEventId))
    .groupBy(demoSlots.id)

  const empty = legacy.filter((s) => Number(s.bookings) === 0)
  console.log(`Slots with an old slot-wide calendar event: ${legacy.length}`)
  console.log(`  ${empty.length} have no bookings → their calendar event is removed`)
  console.log(`  ${legacy.length - empty.length} have bookings → kept (their bookers already have that Meet link)`)

  let cleared = 0
  let failed = 0
  if (apply) {
    for (const slot of empty) {
      // Re-checked under the slot's lock: someone may book it while this runs.
      const eventId = await db.transaction(async (tx) => {
        const locked = await tx.execute(sql`select google_event_id from demo_slots where id = ${slot.id} for update`)
        const row = locked.rows[0] as { google_event_id: string | null } | undefined
        if (!row?.google_event_id) return null
        const [booked] = await tx.select({ n: count() }).from(demoBookings).where(eq(demoBookings.slotId, slot.id))
        if ((booked?.n ?? 0) > 0) return null
        await tx
          .update(demoSlots)
          .set({ googleEventId: null, meetUrl: null, meetConference: null })
          .where(eq(demoSlots.id, slot.id))
        return row.google_event_id
      })
      if (!eventId) continue
      try {
        await deleteDemoEvent(eventId, { notify: false })
        cleared++
      } catch (error) {
        failed++
        console.error(`  could not delete calendar event for slot at ${slot.startsAt.toISOString()}:`, error)
      }
    }
    console.log(`\nRemoved ${cleared} calendar events${failed ? `, ${failed} failed (delete those by hand)` : ''}.`)
  }

  const upcoming = await db
    .select({ n: count() })
    .from(demoBookings)
    .innerJoin(demoSlots, eq(demoSlots.id, demoBookings.slotId))
    .where(sql`${demoSlots.startsAt} > now() and ${demoBookings.reminderEmailId} is null`)
  console.log(`\nUpcoming bookings without a reminder: ${upcoming[0]?.n ?? 0}`)
  if (apply) console.log('  reminders:', await scheduleDueReminders())

  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
