import { NextResponse, after } from 'next/server'
import { z } from 'zod'
import { clientIp } from '@/lib/auth/rate-limit'
import { sendDemoBookedToAdmin, sendDemoBookedToBooker } from '@/lib/demo/email'
import { bookSeat, bookingsFromIpToday } from '@/lib/demo/slots'
import { formatSlot, safeTimeZone } from '@/lib/demo/time'
import { verifyTurnstile } from '@/lib/demo/turnstile'

export const runtime = 'nodejs'

/** Generous for a family sharing one connection; tight for a script. */
const MAX_BOOKINGS_PER_IP_PER_DAY = 5

const body = z.object({
  slotId: z.uuid({ error: 'Choose a time.' }),
  name: z.string({ error: 'Enter your name.' }).trim().min(2, 'Enter your name.').max(80),
  email: z.email('Enter a valid email address.').max(160),
  // Same rule as checkout: international numbers, so count digits rather than
  // guess at formats.
  phone: z
    .string({ error: 'Enter your phone number.' })
    .trim()
    .min(1, 'Enter your phone number.')
    .max(20)
    .regex(/^[+()\d\s.-]+$/, 'Enter a valid phone number.')
    .refine((v) => (v.match(/\d/g) ?? []).length >= 7, 'Enter a valid phone number.'),
  levelNote: z
    .string({ error: 'Tell us a little about your French.' })
    .trim()
    .min(2, 'Tell us a little about your French.')
    .max(500, 'Keep it under 500 characters.'),
  timeZone: z.string().max(64).optional(),
  turnstileToken: z.string().max(4096).optional(),
})

export async function POST(request: Request) {
  const ip = clientIp(request)

  const parsed = body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' },
      { status: 400 },
    )
  }
  const input = parsed.data

  if (!(await verifyTurnstile(input.turnstileToken, ip))) {
    return NextResponse.json({ error: 'Please complete the check and try again.' }, { status: 400 })
  }

  if ((await bookingsFromIpToday(ip)) >= MAX_BOOKINGS_PER_IP_PER_DAY) {
    return NextResponse.json(
      { error: 'Too many bookings from this connection today. Please message us instead.' },
      { status: 429 },
    )
  }

  const timeZone = safeTimeZone(input.timeZone) ?? 'UTC'
  const result = await bookSeat({
    slotId: input.slotId,
    name: input.name,
    email: input.email,
    phone: input.phone,
    levelNote: input.levelNote,
    timeZone,
    ip,
  })

  switch (result.status) {
    case 'booked':
      break
    case 'full':
      return NextResponse.json(
        { error: 'Sorry — that time was just taken. Please choose another.', refresh: true },
        { status: 409 },
      )
    case 'closed':
      return NextResponse.json(
        { error: 'That time is too close to book now. Please choose a later one.', refresh: true },
        { status: 409 },
      )
    case 'not-found':
      return NextResponse.json(
        { error: 'That time is no longer available. Please choose another.', refresh: true },
        { status: 409 },
      )
    case 'already-in-slot':
      return NextResponse.json({ error: 'You are already booked into this class.' }, { status: 409 })
    case 'already-booked':
      return NextResponse.json(
        {
          error: `You already have a demo class booked for ${formatSlot(result.startsAt, timeZone)}. Check your email for the link.`,
        },
        { status: 409 },
      )
  }

  const booking = {
    bookingId: result.bookingId,
    name: input.name,
    email: input.email,
    phone: input.phone,
    levelNote: input.levelNote,
    timeZone,
    seat: result.seat,
    startsAt: result.startsAt,
    meetUrl: result.meetUrl,
  }

  // After the response: the booker sees "booked" without waiting on two
  // round trips to Resend, and a slow or failed send cannot undo a seat.
  after(async () => {
    await Promise.all([sendDemoBookedToBooker(booking), sendDemoBookedToAdmin(booking)])
  })

  return NextResponse.json({
    ok: true,
    startsAt: result.startsAt.toISOString(),
    when: formatSlot(result.startsAt, timeZone),
    meetUrl: result.meetUrl,
  })
}
