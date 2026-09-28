/**
 * Exercises demo booking against a LOCAL database only. Touches nothing but
 * the two demo tables — it never reads or writes a buyer's rows.
 *
 *   DATABASE_URL=postgresql://postgres:dev@localhost:55432/fot_study_dev pnpm check:demo
 *
 * The cases are the ones that turn into two strangers and a third person all
 * turning up to a call meant for two.
 */
import { eq, sql } from 'drizzle-orm'
import { db, demoBookings, demoSlots } from '../db'
import { bookSeat, createSlot, deleteBooking, deleteSlot, listBookableSlots } from '../lib/demo/slots'
import { formatSlot, safeTimeZone } from '../lib/demo/time'
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

async function reset() {
  await db.delete(demoBookings)
  await db.delete(demoSlots)
}

async function main() {
  await reset()

  console.log('\nslots')
  const a = await createSlot({ startsAt: hours(48), meetUrl: 'https://meet.google.com/aaa-bbbb-ccc' })
  check('slot created with a pasted link', a.status === 'created')
  const clash = await createSlot({ startsAt: new Date(hours(48).getTime() + 15 * 60_000), meetUrl: 'https://meet.google.com/x' })
  check('a slot overlapping another is refused', clash.status === 'overlaps')
  const noLink = await createSlot({ startsAt: hours(72) })
  check('without Google or a link, a slot is refused', noLink.status === 'needs-link')
  if (a.status !== 'created') throw new Error('cannot continue')

  console.log('\nconcurrency: five people race for two seats')
  const race = await Promise.all([1, 2, 3, 4, 5].map((n) => bookSeat({ slotId: a.id, ...person(n) })))
  const won = race.filter((r) => r.status === 'booked')
  const full = race.filter((r) => r.status === 'full')
  check('exactly two bookings succeed', won.length === 2, `${won.length} booked`)
  check('the other three are told it is full', full.length === 3, race.map((r) => r.status).join(','))
  const seats = await db.select({ seat: demoBookings.seat }).from(demoBookings).where(eq(demoBookings.slotId, a.id))
  check('the slot holds exactly seats 1 and 2', seats.map((s) => s.seat).sort().join() === '1,2')
  check('both bookers get the same Meet link', won.every((r) => r.status === 'booked' && r.meetUrl === 'https://meet.google.com/aaa-bbbb-ccc'))

  const listed = (await listBookableSlots()).find((s) => s.id === a.id)
  check('the public list shows it as full', listed?.seatsLeft === 0)

  console.log('\nrules')
  const b = await createSlot({ startsAt: hours(96), meetUrl: 'https://meet.google.com/bbb-cccc-ddd' })
  if (b.status !== 'created') throw new Error('cannot continue')
  const winner = race.indexOf(won[0]) + 1
  const again = await bookSeat({ slotId: b.id, ...person(winner) })
  check('one upcoming demo per email', again.status === 'already-booked', again.status)

  const first = await bookSeat({ slotId: b.id, ...person(10) })
  const twice = await bookSeat({ slotId: b.id, ...person(10), email: 'LEARNER10@example.com' })
  check('the same person cannot take both seats', first.status === 'booked' && twice.status === 'already-in-slot', twice.status)

  const soon = await createSlot({ startsAt: new Date(Date.now() + 20 * 60_000), meetUrl: 'https://meet.google.com/soon' })
  if (soon.status === 'created') {
    const late = await bookSeat({ slotId: soon.id, ...person(20) })
    check('a slot inside the cutoff cannot be booked', late.status === 'closed', late.status)
    check('and is not listed', !(await listBookableSlots()).some((s) => s.id === soon.id))
  }

  const missing = await bookSeat({ slotId: '00000000-0000-0000-0000-000000000000', ...person(30) })
  check('an unknown slot is refused', missing.status === 'not-found')

  console.log('\nremoving')
  check('a booked slot cannot be deleted', (await deleteSlot(b.id)).status === 'has-bookings')
  if (first.status === 'booked') {
    const [row] = await db.select().from(demoBookings).where(eq(demoBookings.email, 'learner10@example.com'))
    check('a booking can be removed', await deleteBooking(row.id))
  }
  check('then the empty slot can be deleted', (await deleteSlot(b.id)).status === 'deleted')

  // Seat 1 freed while seat 2 is still held: the next booker must get seat 1.
  const c = await createSlot({ startsAt: hours(120), meetUrl: 'https://meet.google.com/ccc' })
  if (c.status === 'created') {
    await bookSeat({ slotId: c.id, ...person(40) })
    await bookSeat({ slotId: c.id, ...person(41) })
    const [seat1] = await db.select().from(demoBookings).where(sql`${demoBookings.slotId} = ${c.id} and ${demoBookings.seat} = 1`)
    await deleteBooking(seat1.id)
    const refill = await bookSeat({ slotId: c.id, ...person(42) })
    check('a freed seat 1 is reused, not collided with', refill.status === 'booked' && refill.seat === 1, refill.status)
  }

  console.log('\nschema backstop')
  let thirdRejected = false
  try {
    await db.insert(demoBookings).values({ slotId: a.id, seat: 3, ...person(50) })
  } catch {
    thirdRejected = true
  }
  check('the database itself refuses a seat 3', thirdRejected)

  console.log('\ntime zones')
  const at = new Date('2026-11-10T13:30:00Z')
  check('India', formatSlot(at, 'Asia/Kolkata').includes('7:00 pm'), formatSlot(at, 'Asia/Kolkata'))
  check('Paris in winter', formatSlot(at, 'Europe/Paris').includes('2:30 pm'), formatSlot(at, 'Europe/Paris'))
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
