import { and, count, eq, gte, lt } from 'drizzle-orm'
import type { Db } from '@/db'
import { loginAttempts } from '@/db'

/** Ten failures from one address in fifteen minutes is not a person typing. */
const WINDOW_MINUTES = 15
const MAX_FAILURES = 10
const KEEP_MINUTES = 60

export type RateVerdict = { allowed: boolean; retryAfterSeconds: number }

/**
 * Postgres-backed on purpose. An in-memory counter is per-lambda, so on Vercel
 * it resets whenever a new instance handles the request — which is exactly when
 * someone is hammering the endpoint.
 */
export async function checkLoginRate(db: Db, ip: string): Promise<RateVerdict> {
  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000)
  const [row] = await db
    .select({ failures: count() })
    .from(loginAttempts)
    .where(
      and(
        eq(loginAttempts.ip, ip),
        eq(loginAttempts.succeeded, false),
        gte(loginAttempts.attemptedAt, since),
      ),
    )

  const failures = row?.failures ?? 0
  return failures >= MAX_FAILURES
    ? { allowed: false, retryAfterSeconds: WINDOW_MINUTES * 60 }
    : { allowed: true, retryAfterSeconds: 0 }
}

export async function recordLoginAttempt(
  db: Db,
  ip: string,
  succeeded: boolean,
): Promise<void> {
  await db.insert(loginAttempts).values({ ip, succeeded })
  // Opportunistic cleanup; the table is write-heavy and read-narrow.
  await db
    .delete(loginAttempts)
    .where(lt(loginAttempts.attemptedAt, new Date(Date.now() - KEEP_MINUTES * 60_000)))
}

/**
 * Behind Vercel the client address is the first entry of x-forwarded-for.
 * Falls back to a constant so a missing header throttles globally rather than
 * silently disabling the limit.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  return request.headers.get('x-real-ip')?.trim() || 'unknown'
}
