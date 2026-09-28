import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/db'
import { checkLoginRate, clientIp, recordLoginAttempt } from '@/lib/auth/rate-limit'
import { adminConfigured, createAdminSession, verifyAdminPassword } from '@/lib/demo/admin-auth'

export const runtime = 'nodejs'

const body = z.object({ password: z.string().min(1).max(200) })

export async function POST(request: Request) {
  if (!adminConfigured()) {
    return NextResponse.json({ error: 'Admin login is not configured.' }, { status: 503 })
  }

  // Same table as the buyer login, under its own key, so failures here can
  // never count against a buyer signing in from the same address.
  const key = `admin:${clientIp(request)}`

  const parsed = body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Enter the password.' }, { status: 400 })
  }

  const rate = await checkLoginRate(db, key)
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'Too many attempts. Try again in a few minutes.' },
      { status: 429, headers: { 'retry-after': String(rate.retryAfterSeconds) } },
    )
  }

  if (!(await verifyAdminPassword(parsed.data.password))) {
    await recordLoginAttempt(db, key, false)
    return NextResponse.json({ error: 'Wrong password.' }, { status: 401 })
  }

  await createAdminSession()
  await recordLoginAttempt(db, key, true)
  return NextResponse.json({ ok: true })
}
