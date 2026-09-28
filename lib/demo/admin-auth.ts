import { createHash } from 'node:crypto'
import { cookies } from 'next/headers'
import { verify } from '@node-rs/argon2'
import { SignJWT, jwtVerify } from 'jose'

/**
 * One owner, one password. Entirely separate from the buyer login: its own
 * cookie, its own signing secret, no table. Nothing here reads or writes a
 * buyer's session, so signing in or out as the owner cannot touch a reader.
 *
 * ADMIN_PASSWORD_HASH holds an argon2id hash, base64-encoded — raw argon2
 * hashes are full of `$`, which `.env` files expand as variables. Generate it
 * with `pnpm admin:password`.
 */

export const ADMIN_COOKIE = 'fot_study_admin'
const MAX_AGE_SECONDS = 60 * 60 * 12

function storedHash(): string | null {
  const encoded = process.env.ADMIN_PASSWORD_HASH
  if (!encoded) return null
  const decoded = Buffer.from(encoded, 'base64').toString('utf8')
  return decoded.startsWith('$argon2') ? decoded : null
}

function secret(): Uint8Array | null {
  const value = process.env.ADMIN_SESSION_SECRET
  // Short secrets make HS256 guessable offline from a single stolen cookie.
  if (!value || value.length < 32) return null
  return new TextEncoder().encode(value)
}

/**
 * Carried in the token, so changing the password signs out every existing
 * owner session without needing a sessions table.
 */
function passwordFingerprint(hash: string): string {
  return createHash('sha256').update(hash).digest('hex').slice(0, 16)
}

export function adminConfigured(): boolean {
  return storedHash() !== null && secret() !== null
}

export async function verifyAdminPassword(password: string): Promise<boolean> {
  const hash = storedHash()
  if (!hash) return false
  try {
    return await verify(hash, password)
  } catch {
    return false
  }
}

export async function createAdminSession(): Promise<void> {
  const hash = storedHash()
  const key = secret()
  if (!hash || !key) throw new Error('Admin login is not configured')

  const token = await new SignJWT({ pf: passwordFingerprint(hash) })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('admin')
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(key)

  const store = await cookies()
  store.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    // Strict: every admin action is a same-site fetch, so this is also the
    // CSRF defence — a cross-site form post arrives without the cookie.
    sameSite: 'strict',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  })
}

export async function isAdmin(): Promise<boolean> {
  const hash = storedHash()
  const key = secret()
  if (!hash || !key) return false

  const token = (await cookies()).get(ADMIN_COOKIE)?.value
  if (!token) return false
  try {
    const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'], subject: 'admin' })
    return payload.pf === passwordFingerprint(hash)
  } catch {
    return false
  }
}

export async function destroyAdminSession(): Promise<void> {
  const store = await cookies()
  store.set(ADMIN_COOKIE, '', { httpOnly: true, sameSite: 'strict', path: '/', maxAge: 0 })
}
