import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE } from '@/lib/auth/cookie'

/**
 * Redirects only. It reads whether a cookie is present, never whether it is
 * valid — authorisation happens inside each route handler and server component,
 * where the session is verified against the signing key and the database.
 *
 * Renamed from `middleware.ts`: Next 16 deprecated that convention in favour of
 * `proxy.ts`, which may be deployed to a CDN and so must stay dependency-light.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const hasCookie = Boolean(request.cookies.get(SESSION_COOKIE)?.value)

  // No `/login + cookie → /library` rule here on purpose. Cookie presence is
  // not a live session: a superseded one would bounce between the two forever
  // and the buyer would never be told they had been signed out elsewhere.
  if (!hasCookie && (pathname.startsWith('/read') || pathname.startsWith('/library'))) {
    const target = new URL('/login', request.url)
    target.searchParams.set('next', pathname)
    return NextResponse.redirect(target)
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/read/:path*', '/library/:path*'],
}
