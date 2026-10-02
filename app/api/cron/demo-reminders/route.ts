import { NextResponse } from 'next/server'
import { scheduleDueReminders } from '@/lib/demo/reminders'

export const runtime = 'nodejs'

/**
 * Run daily by Vercel Cron (vercel.json). Schedules the "starts in an hour"
 * email for every upcoming booking that has none yet — those booked more than
 * 30 days ahead, and any whose scheduling failed at booking time.
 *
 * Vercel sends `Authorization: Bearer $CRON_SECRET`. Without the secret set,
 * the route refuses everyone rather than running for anyone.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }
  const counts = await scheduleDueReminders()
  console.log('[cron] demo reminders', counts)
  return NextResponse.json({ ok: true, ...counts })
}
