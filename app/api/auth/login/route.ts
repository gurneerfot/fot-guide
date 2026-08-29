import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db, users } from '@/db'
import { codeIndex, verifyCode } from '@/lib/auth/code'
import { checkLoginRate, clientIp, recordLoginAttempt } from '@/lib/auth/rate-limit'
import { createSession } from '@/lib/auth/session'

export const runtime = 'nodejs'

const body = z.object({
  code: z.string().min(1, 'Enter your access code.').max(64),
})

/**
 * Verified against when no user matches, so a wrong code and an unknown code
 * cost the same wall-clock time. Without this, response latency tells an
 * attacker which codes exist.
 */
const DECOY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$Xb0kZ8xkPfLmYbEXwvJ1kQaUb3Zt1n0hJ2vJZxKQxHo'

export async function POST(request: Request) {
  const ip = clientIp(request)

  const parsed = body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Enter your access code.' }, { status: 400 })
  }

  const rate = await checkLoginRate(db, ip)
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'Too many attempts. Try again in a few minutes.' },
      { status: 429, headers: { 'retry-after': String(rate.retryAfterSeconds) } },
    )
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.codeIndex, codeIndex(parsed.data.code)))
    .limit(1)

  const valid = user
    ? await verifyCode(user.codeHash, parsed.data.code)
    : (await verifyCode(DECOY_HASH, parsed.data.code), false)

  if (!user || !valid) {
    await recordLoginAttempt(db, ip, false)
    return NextResponse.json({ error: 'That code was not recognised.' }, { status: 401 })
  }

  if (user.status === 'disabled') {
    await recordLoginAttempt(db, ip, false)
    return NextResponse.json(
      { error: 'This account is no longer active. Contact Français on Tips.' },
      { status: 403 },
    )
  }

  // Signing in here signs this code out everywhere else.
  await createSession(
    { id: user.id, name: user.name, email: user.email },
    { userAgent: request.headers.get('user-agent'), ip },
  )
  await recordLoginAttempt(db, ip, true)
  return NextResponse.json({ ok: true, name: user.name })
}
