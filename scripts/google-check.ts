/**
 * Proves the Google setup works end to end, without touching the database:
 * creates one event with a Meet link on the owner's calendar, prints the link,
 * then deletes the event again.
 *
 *   pnpm google:check
 *
 * Run it after `pnpm google:auth`, and again whenever Meet links stop appearing.
 */
import { randomUUID } from 'node:crypto'
import { createMeetEvent, deleteMeetEvent, googleConfigured } from '../lib/demo/google'

async function main() {
  if (!googleConfigured()) {
    console.error('Missing GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET or GOOGLE_REFRESH_TOKEN in .env.local.')
    process.exit(1)
  }

  // Tomorrow, so it cannot collide with anything happening now.
  const startsAt = new Date(Date.now() + 24 * 60 * 60_000)
  startsAt.setMinutes(0, 0, 0)
  const endsAt = new Date(startsAt.getTime() + 30 * 60_000)

  console.log('Creating a test event with a Meet link…')
  const event = await createMeetEvent({ slotId: randomUUID(), startsAt, endsAt })
  console.log(`  ok   Meet link: ${event.meetUrl}`)

  await deleteMeetEvent(event.eventId)
  console.log('  ok   test event deleted again')
  console.log('\nGoogle is set up. Every slot planned in /admin will get its own Meet link.')
}

main().catch((error) => {
  console.error(`\n FAIL  ${error instanceof Error ? error.message : error}`)
  process.exit(1)
})
