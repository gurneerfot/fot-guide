import { NextResponse } from 'next/server'
import { z } from 'zod'
import { isAdmin } from '@/lib/demo/admin-auth'
import { createSlot, deleteSlot } from '@/lib/demo/slots'
import { DEFAULT_SEATS, MAX_SEATS } from '@/lib/demo/time'

export const runtime = 'nodejs'

const create = z.object({
  /** An instant, converted from the owner's local time in their browser. */
  startsAt: z.iso.datetime({ offset: true, error: 'Pick a date and time.' }),
  capacity: z
    .number({ error: 'Choose how many seats.' })
    .int('Seats must be a whole number.')
    .min(1, 'At least one seat.')
    .max(MAX_SEATS, `At most ${MAX_SEATS} seats.`)
    .default(DEFAULT_SEATS),
})

const remove = z.object({ id: z.uuid() })

export async function POST(request: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: 'Signed out.' }, { status: 401 })

  const parsed = create.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Check the form.' },
      { status: 400 },
    )
  }

  const startsAt = new Date(parsed.data.startsAt)
  if (startsAt.getTime() <= Date.now()) {
    return NextResponse.json({ error: 'That time has already passed.' }, { status: 400 })
  }
  if (startsAt.getTime() > Date.now() + 366 * 24 * 60 * 60_000) {
    return NextResponse.json({ error: 'That is more than a year away.' }, { status: 400 })
  }

  try {
    const result = await createSlot({
      startsAt,
      capacity: parsed.data.capacity,
    })
    switch (result.status) {
      case 'created':
        return NextResponse.json({ ok: true, id: result.id })
      case 'overlaps':
        return NextResponse.json(
          { error: 'Another slot starts within 30 minutes of that time.' },
          { status: 409 },
        )
      case 'needs-link':
        return NextResponse.json(
          {
            error:
              'Google Calendar is not connected. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REFRESH_TOKEN.',
          },
          { status: 503 },
        )
    }
  } catch (error) {
    console.error('[admin] slot creation failed', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not create the slot.' },
      { status: 502 },
    )
  }
}

export async function DELETE(request: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: 'Signed out.' }, { status: 401 })

  const parsed = remove.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Unknown slot.' }, { status: 400 })

  const result = await deleteSlot(parsed.data.id)
  switch (result.status) {
    case 'deleted':
      return NextResponse.json({ ok: true })
    case 'has-bookings':
      return NextResponse.json(
        { error: 'Someone is booked into this slot. Remove their booking first.' },
        { status: 409 },
      )
    case 'not-found':
      return NextResponse.json({ error: 'That slot no longer exists.' }, { status: 404 })
  }
}
