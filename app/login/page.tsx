import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSessionState } from '@/lib/auth/session'
import { SiteHeader } from '@/app/_components/site-header'
import { LoginForm } from './login-form'

export const dynamic = 'force-dynamic'

const NOTICE: Record<string, string> = {
  superseded:
    'Your code was used to sign in on another device, so you were signed out here. Your access code works on one device at a time.',
  disabled: 'This account is no longer active. Please contact Français on Tips.',
  expired: 'This temporary access code has expired.',
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const state = await getSessionState()
  const { next } = await searchParams

  // Verified here rather than in the proxy, so a revoked cookie lands on the
  // explanation below instead of bouncing between two routes forever.
  if (state.status === 'active') redirect(next?.startsWith('/') ? next : '/library')

  const notice = NOTICE[state.status]

  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-5 py-16">
        <header className="mb-8 text-center">
          <h1 className="font-display text-2xl font-medium">Sign in to read</h1>
          <p className="mt-3 text-read text-ink-soft">
            Enter the access code from your purchase email.
          </p>
        </header>

        {notice && (
          <p
            role="status"
            className="mb-6 rounded border border-rule bg-card px-4 py-3 text-sm text-ink-soft"
          >
            {notice}
          </p>
        )}

        <LoginForm next={next} />

        <p className="mt-8 text-center text-sm text-ink-soft">
          Haven&rsquo;t bought yet?{' '}
          <Link href="/" className="font-semibold text-ink underline underline-offset-2">
            See the study material
          </Link>
        </p>
      </main>
    </>
  )
}
