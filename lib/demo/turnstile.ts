/**
 * Cloudflare Turnstile, optional. With no secret set every booking is allowed
 * through and only the per-IP limit applies; with one set, a booking without a
 * valid token is refused. Two free seats per slot make a bot filling the
 * calendar with junk the realistic abuse here.
 */
export function turnstileEnabled(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY && process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY)
}

export async function verifyTurnstile(token: string | undefined, ip: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!turnstileEnabled() || !secret) return true
  if (!token) return false
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: new URLSearchParams({ secret, response: token, remoteip: ip }),
    })
    const body = (await response.json()) as { success?: boolean }
    return body.success === true
  } catch (error) {
    // Cloudflare being unreachable should not close the booking page.
    console.error('[demo] turnstile verify failed, allowing', error)
    return true
  }
}
