/**
 * Exercises demo booking against a LOCAL database only. Touches nothing but
 * the two demo tables — it never reads or writes a buyer's rows.
 *
 *   DATABASE_URL=postgresql://postgres:dev@localhost:55432/fot_study_dev pnpm check:demo
 *
 * Google Calendar and Resend are replaced by a stand-in that records what it
 * was asked to do, so nothing here creates a real event or emails anyone.
 *
 * The cases are the ones that turn into three people turning up to a call
 * meant for two, two bookers of one slot landing in different calls, or a
 * seat booked with no way to join it.
 */
import { eq, sql } from 'drizzle-orm'
import { db, demoBookings, demoSlots } from '../db'
import type { Conference } from '../lib/demo/google'
import { bookSeat, createSlot, deleteBooking, deleteSlot, listBookableSlots, type DemoDeps } from '../lib/demo/slots'
import { formatSlot, safeTimeZone } from '../lib/demo/time'
import { reminderTime } from '../lib/demo/reminders'
import { assertLocalDatabase } from './local-only'

assertLocalDatabase()

let failures = 0
function check(label: string, condition: boolean, detail = '') {
  console.log(`${condition ? '  ok  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!condition) failures++
}

const hours = (n: number) => new Date(Date.now() + n * 3_600_000)
const person = (n: number) => ({
  name: `Learner ${n}`,
  email: `learner${n}@example.com`,
  phone: '+91 98765 43210',
  levelNote: 'A2',
  timeZone: 'Europe/Paris',
  ip: '203.0.113.1',
})

/**
 * A pretend Google Calendar. Each new call gets a fresh link; an event given
 * an existing conference joins it. A small delay stands in for the network,
 * so the races below really overlap the calendar call.
 */
function fakeCalendar(options: { failWith?: string } = {}) {
  let calls = 0
  const log = {
    newCalls: 0,
    events: [] as { id: string; attendee?: string; meetUrl: string }[],
    deleted: [] as { id: string; notify: boolean }[],
    cancelledReminders: [] as string[],
    legacyLookups: 0,
  }
  const deps: DemoDeps = {
    async createEvent(input) {
      await new Promise((r) => setTimeout(r, 30))
      if (options.failWith) throw new Error(options.failWith)
      let conference: Conference | null = input.conference
      if (!conference) {
        log.newCalls++
        const url = `https://meet.google.com/fake-${++calls}`
        conference = { conferenceId: `conf-${calls}`, conferenceSolution: {}, entryPoints: [{ entryPointType: 'video', uri: url }] }
      }
      const meetUrl = conference.entryPoints[0].uri
      const id = `evt-${log.events.length + 1}`
      log.events.push({ id, attendee: input.attendee?.email, meetUrl })
      return { eventId: id, conference, meetUrl }
    },
    async deleteEvent(id, { notify }) {
      log.deleted.push({ id, notify })
    },
    async eventConference() {
      log.legacyLookups++
      return { conferenceId: 'legacy', conferenceSolution: {}, entryPoints: [{ entryPointType: 'video', uri: 'https://meet.google.com/legacy-call' }] }
    },
    async cancelReminder(id) {
      log.cancelledReminders.push(id)
    },
  }
  return { deps, log }
}

async function reset() {
  await db.delete(demoBookings)
  await db.delete(demoSlots)
}

async function main() {
  await reset()

  console.log('\nslots')
  const a = await createSlot({ startsAt: hours(48), capacity: 2 })
  check('a slot is created with no Google call and no link yet', a.status === 'created')
  if (a.status !== 'created') throw new Error('cannot continue')
  const [fresh] = await db.select().from(demoSlots).where(eq(demoSlots.id, a.id))
  check('…its Meet link is empty until someone books', fresh.meetUrl === null && fresh.meetConference === null)
  const clash = await createSlot({ startsAt: new Date(hours(48).getTime() + 15 * 60_000), capacity: 2 })
  check('a slot overlapping another is refused', clash.status === 'overlaps')

  console.log('\nconcurrency: five people race for two seats')
  const cal = fakeCalendar()
  const race = await Promise.all([1, 2, 3, 4, 5].map((n) => bookSeat({ slotId: a.id, ...person(n) }, cal.deps)))
  const won = race.filter((r) => r.status === 'booked')
  check('exactly two bookings succeed', won.length === 2, `${won.length} booked`)
  check('the other three are told it is full', race.filter((r) => r.status === 'full').length === 3, race.map((r) => r.status).join(','))
  const seats = await db.select().from(demoBookings).where(eq(demoBookings.slotId, a.id))
  check('the slot holds exactly seats 1 and 2', seats.map((s) => s.seat).sort().join() === '1,2')
  check('exactly one Meet call was started for the slot', cal.log.newCalls === 1, `${cal.log.newCalls} started`)
  check('each booker got their own calendar event', cal.log.events.length === 2 && new Set(cal.log.events.map((e) => e.attendee)).size === 2)
  check('both bookers share one Meet link', new Set(won.map((r) => r.status === 'booked' && r.meetUrl)).size === 1)
  check('each booking records its own event', seats.every((s) => s.googleEventId?.startsWith('evt-')))
  const [afterA] = await db.select().from(demoSlots).where(eq(demoSlots.id, a.id))
  check('the slot now stores the call for later bookers', afterA.meetUrl === 'https://meet.google.com/fake-1' && afterA.meetConference !== null)
  check('the public list shows it as full', (await listBookableSlots()).find((s) => s.id === a.id)?.seatsLeft === 0)

  console.log('\nGoogle failing')
  const b = await createSlot({ startsAt: hours(96), capacity: 2 })
  if (b.status !== 'created') throw new Error('cannot continue')
  const broken = fakeCalendar({ failWith: 'invalid_grant: Token has been expired or revoked.' })
  const failed = await bookSeat({ slotId: b.id, ...person(30) }, broken.deps)
  check('a booking Google refuses is reported, not saved', failed.status === 'calendar-failed', failed.status)
  const leftover = await db.select().from(demoBookings).where(eq(demoBookings.slotId, b.id))
  check('…and leaves no seat taken behind', leftover.length === 0)
  const retry = await bookSeat({ slotId: b.id, ...person(30) }, cal.deps)
  check('…and the same person can book once Google works again', retry.status === 'booked', retry.status)

  console.log('\nrules')
  const winner = race.indexOf(won[0]) + 1
  const again = await bookSeat({ slotId: b.id, ...person(winner) }, cal.deps)
  check('one upcoming demo per email', again.status === 'already-booked', again.status)
  const first = await bookSeat({ slotId: b.id, ...person(10) }, cal.deps)
  const twice = await bookSeat({ slotId: b.id, ...person(10), email: 'LEARNER10@example.com' }, cal.deps)
  check('the same person cannot take two seats', first.status === 'booked' && twice.status === 'already-in-slot', twice.status)
  const soon = await createSlot({ startsAt: new Date(Date.now() + 20 * 60_000), capacity: 2 })
  if (soon.status === 'created') {
    const late = await bookSeat({ slotId: soon.id, ...person(20) }, cal.deps)
    check('a slot inside the cutoff cannot be booked', late.status === 'closed', late.status)
    check('…and is not listed', !(await listBookableSlots()).some((s) => s.id === soon.id))
  }
  const missing = await bookSeat({ slotId: '00000000-0000-0000-0000-000000000000', ...person(31) }, cal.deps)
  check('an unknown slot is refused', missing.status === 'not-found')

  console.log('\nremoving')
  check('a booked slot cannot be deleted', (await deleteSlot(b.id, cal.deps)).status === 'has-bookings')
  const bBookings = await db.select().from(demoBookings).where(eq(demoBookings.slotId, b.id))
  await db.update(demoBookings).set({ reminderEmailId: 'resend-123' }).where(eq(demoBookings.id, bBookings[0].id))
  const deletedBefore = cal.log.deleted.length
  for (const row of bBookings) check(`booking ${row.seat} can be removed`, await deleteBooking(row.id, cal.deps))
  const removedEvents = cal.log.deleted.slice(deletedBefore)
  check('…its calendar event is deleted, telling the booker', removedEvents.length === 2 && removedEvents.every((d) => d.notify))
  check('…and its scheduled reminder is cancelled', cal.log.cancelledReminders.includes('resend-123'))
  check('then the empty slot can be deleted', (await deleteSlot(b.id, cal.deps)).status === 'deleted')

  // Seat 1 freed while seat 2 is held: the next booker takes seat 1 and joins
  // the call the slot already has.
  const c = await createSlot({ startsAt: hours(120), capacity: 2 })
  if (c.status === 'created') {
    await bookSeat({ slotId: c.id, ...person(40) }, cal.deps)
    await bookSeat({ slotId: c.id, ...person(41) }, cal.deps)
    const [seat1] = await db.select().from(demoBookings).where(sql`${demoBookings.slotId} = ${c.id} and ${demoBookings.seat} = 1`)
    const callsBefore = cal.log.newCalls
    await deleteBooking(seat1.id, cal.deps)
    const refill = await bookSeat({ slotId: c.id, ...person(42) }, cal.deps)
    check('a freed seat 1 is reused, not collided with', refill.status === 'booked' && refill.seat === 1, refill.status)
    check('…and the newcomer joins the existing call', cal.log.newCalls === callsBefore)
  }

  console.log('\nslots planned before per-booking events')
  const legacy = await createSlot({ startsAt: hours(130), capacity: 2 })
  if (legacy.status === 'created') {
    await db.update(demoSlots).set({ googleEventId: 'old-slot-event', meetUrl: 'https://meet.google.com/legacy-call' }).where(eq(demoSlots.id, legacy.id))
    const callsBefore = cal.log.newCalls
    const joined = await bookSeat({ slotId: legacy.id, ...person(43) }, cal.deps)
    check('a booking joins the call its slot-wide event already has', joined.status === 'booked' && joined.meetUrl === 'https://meet.google.com/legacy-call' && cal.log.newCalls === callsBefore)
  }

  console.log('\ncustom seats: eight people race for five')
  const five = await createSlot({ startsAt: hours(144), capacity: 5 })
  if (five.status !== 'created') throw new Error('cannot continue')
  const rushCal = fakeCalendar()
  const rush = await Promise.all([60, 61, 62, 63, 64, 65, 66, 67].map((n) => bookSeat({ slotId: five.id, ...person(n) }, rushCal.deps)))
  check('exactly five bookings succeed', rush.filter((r) => r.status === 'booked').length === 5, rush.map((r) => r.status).join(','))
  const fiveSeats = await db.select({ seat: demoBookings.seat }).from(demoBookings).where(eq(demoBookings.slotId, five.id))
  check('seats 1–5, no gaps, no repeats', fiveSeats.map((s) => s.seat).sort().join() === '1,2,3,4,5')
  check('five events, one call', rushCal.log.events.length === 5 && rushCal.log.newCalls === 1)
  const one = await createSlot({ startsAt: hours(168), capacity: 1 })
  if (one.status === 'created') {
    const solo = await Promise.all([70, 71].map((n) => bookSeat({ slotId: one.id, ...person(n) }, cal.deps)))
    check('a one-seat slot takes exactly one', solo.filter((r) => r.status === 'booked').length === 1)
  }

  console.log('\nschema backstop')
  const refused = async (seat: number, slotId: string) => {
    try {
      await db.insert(demoBookings).values({ slotId, seat, ...person(80 + seat) })
      return false
    } catch {
      return true
    }
  }
  check('the database refuses seat 3 in a two-seat slot', await refused(3, a.id))
  check('the database refuses seat 6 in a five-seat slot', await refused(6, five.id))
  check('the database refuses seat 0', await refused(0, a.id))
  let tooBig = false
  try {
    await db.insert(demoSlots).values({ startsAt: hours(200), capacity: 51 })
  } catch {
    tooBig = true
  }
  check('the database refuses more than 50 seats', tooBig)

  console.log('\nreminders and time zones')
  const start = new Date('2026-11-10T13:30:00Z')
  check('the reminder is due an hour before the class', reminderTime(start).toISOString() === '2026-11-10T12:30:00.000Z')
  check('India', formatSlot(start, 'Asia/Kolkata').includes('7:00 pm'), formatSlot(start, 'Asia/Kolkata'))
  check('Paris in winter', formatSlot(start, 'Europe/Paris').includes('2:30 pm'), formatSlot(start, 'Europe/Paris'))
  const summer = new Date('2026-07-10T13:30:00Z')
  check('Paris in summer', formatSlot(summer, 'Europe/Paris').includes('3:30 pm'), formatSlot(summer, 'Europe/Paris'))
  check('a junk zone is rejected', safeTimeZone('Mars/Olympus') === null && safeTimeZone('Europe/Paris') === 'Europe/Paris')

  await reset()
  console.log(failures ? `\n${failures} FAILED\n` : '\nall passed\n')
  process.exit(failures ? 1 : 0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
