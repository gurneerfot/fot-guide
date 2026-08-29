import { cache } from 'react'
import { cookies } from 'next/headers'
import { and, eq, isNull, ne } from 'drizzle-orm'
import { SignJWT, jwtVerify } from 'jose'
import { db, sessions, users } from '@/db'
import { SESSION_COOKIE } from './cookie'

const COOKIE = SESSION_COOKIE
/** Long enough that a buyer reading over several evenings is not re-typing a code. */
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30
/** last_seen_at is a liveness hint, not an audit trail — one write a minute. */
const TOUCH_AFTER_MS = 60_000

export type Session = {
  userId: string
  sessionId: string
  name: string
  email: string
}

/**
 * `superseded` means the code was used to sign in somewhere else. It is a
 * distinct state from being signed out so the losing device can say why rather
 * than silently bouncing to a login form — which reads as a bug, and generates
 * a support message instead of the intended deterrent.
 */
export type SessionState =
  | { status: 'active'; session: Session }
  | { status: 'none' }
  | { status: 'superseded' }
  | { status: 'disabled' }

function secret(): Uint8Array {
  const value = process.env.SESSION_SECRET
  if (!value) throw new Error('SESSION_SECRET is not set')
  return new TextEncoder().encode(value)
}

/**
 * Signs in on this device and signs out every other one. A code holds exactly
 * one live session; that is the whole anti-sharing design.
 */
export async function createSession(
  user: { id: string; name: string; email: string },
  device: { userAgent: string | null; ip: string },
): Promise<Session> {
  const [row] = await db
    .insert(sessions)
    .values({ userId: user.id, userAgent: device.userAgent, ip: device.ip })
    .returning()

  await db
    .update(sessions)
    .set({ revokedAt: new Date(), endedBy: 'superseded' })
    .where(
      and(eq(sessions.userId, user.id), ne(sessions.id, row.id), isNull(sessions.revokedAt)),
    )

  const token = await new SignJWT({ name: user.name, email: user.email, sid: row.id })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secret())

  const store = await cookies()
  store.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  })

  return { userId: user.id, sessionId: row.id, name: user.name, email: user.email }
}

/**
 * The real check. A valid signature is necessary but not sufficient — the
 * session row must still be live and the account still active, so revoking a
 * device or disabling a buyer takes effect on their next request rather than
 * whenever their token happens to expire.
 *
 * `cache` dedupes this within a single render, so a page and its layout share
 * one query rather than two.
 */
export const getSessionState = cache(async (): Promise<SessionState> => {
  const token = (await cookies()).get(COOKIE)?.value
  if (!token) return { status: 'none' }

  let userId: string
  let sessionId: string
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ['HS256'] })
    if (!payload.sub || typeof payload.sid !== 'string') return { status: 'none' }
    userId = payload.sub
    sessionId = payload.sid
  } catch {
    // Expired, tampered with, or signed under a rotated secret.
    return { status: 'none' }
  }

  const [row] = await db
    .select({
      revokedAt: sessions.revokedAt,
      endedBy: sessions.endedBy,
      lastSeenAt: sessions.lastSeenAt,
      ownerId: sessions.userId,
      name: users.name,
      email: users.email,
      userStatus: users.status,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, sessionId))
    .limit(1)

  if (!row || row.ownerId !== userId) return { status: 'none' }
  if (row.revokedAt) {
    return row.endedBy === 'superseded' ? { status: 'superseded' } : { status: 'none' }
  }
  if (row.userStatus === 'disabled') return { status: 'disabled' }

  if (Date.now() - row.lastSeenAt.getTime() > TOUCH_AFTER_MS) {
    await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, sessionId))
  }

  return {
    status: 'active',
    session: { userId, sessionId, name: row.name, email: row.email },
  }
})

/** The common case: a session or nothing. Use `getSessionState` when the
 *  reason matters — which is only on the login screen. */
export async function readSession(): Promise<Session | null> {
  const state = await getSessionState()
  return state.status === 'active' ? state.session : null
}

export async function destroySession(): Promise<void> {
  const state = await getSessionState()
  if (state.status === 'active') {
    await db
      .update(sessions)
      .set({ revokedAt: new Date(), endedBy: 'signed_out' })
      .where(eq(sessions.id, state.session.sessionId))
  }
  const store = await cookies()
  store.set(COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 })
}
