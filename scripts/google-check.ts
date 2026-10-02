/**
 * Proves the Google setup works end to end, without touching the database or
 * emailing anyone: creates an event with a new Meet call, a second event that
 * joins the same call (as a second booking in a slot would), checks both carry
 * the same link, then deletes both.
 *
 *   pnpm google:check
 *
 * Run it after `pnpm google:auth`, and again whenever bookings report a
 * Google error.
 */
import { randomUUID } from 'node:crypto'
import { createDemoEvent, deleteDemoEvent, googleConfigured } from '../lib/demo/google'

async function main() {
  if (!googleConfigured()) {
    console.error('Missing GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET or GOOGLE_REFRESH_TOKEN in .env.local.')
    process.exit(1)
  }

  // Tomorrow, so it cannot collide with anything happening now.
  const startsAt = new Date(Date.now() + 24 * 60 * 60_000)
  startsAt.setMinutes(0, 0, 0)
  const endsAt = new Date(startsAt.getTime() + 30 * 60_000)
  const event = { startsAt, endsAt, summary: 'google:check test — deleted at once', description: 'Test event.' }

  const created: string[] = []
  try {
    console.log('Creating a test event with a new Meet call…')
    const first = await createDemoEvent({ ...event, requestId: randomUUID(), conference: null })
    created.push(first.eventId)
    console.log(`  ok   Meet link: ${first.meetUrl}`)

    console.log('Creating a second event in the same call…')
    const second = await createDemoEvent({ ...event, requestId: randomUUID(), conference: first.conference })
    created.push(second.eventId)
    if (second.meetUrl !== first.meetUrl) throw new Error(`second event got a different link: ${second.meetUrl}`)
    console.log(`  ok   same link: ${second.meetUrl}`)
  } finally {
    for (const id of created) await deleteDemoEvent(id, { notify: false })
    if (created.length) console.log(`  ok   ${created.length} test event(s) deleted again`)
  }
  console.log('\nGoogle is set up. Each booking gets its own invite; bookings in one slot share one Meet link.')
}

main().catch((error) => {
  console.error(`\n FAIL  ${error instanceof Error ? error.message : error}`)
  process.exit(1)
})
