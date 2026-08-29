import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { readSession } from '@/lib/auth/session'
import { libraryFor } from '@/lib/entitlement'
import { SiteHeader } from '@/app/_components/site-header'
import { SignOut } from '@/app/_components/sign-out'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { robots: { index: false, follow: false } }

export default async function LibraryPage() {
  const session = await readSession()
  if (!session) redirect('/login?next=/library')

  const owned = await libraryFor(session.userId)

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-2xl px-5 py-14">
        <header className="mb-10 flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-medium">Your material</h1>
            <p className="mt-1 text-sm text-ink-soft">Signed in as {session.name}</p>
          </div>
          <SignOut />
        </header>

        {owned.length === 0 ? (
          <div className="rounded border border-rule bg-card p-8 text-center">
            <p className="text-read text-ink-soft">
              Nothing here yet. If you have just paid, give it a moment and refresh.
            </p>
            <Link
              href="/"
              className="mt-4 inline-block font-semibold text-ink underline underline-offset-2"
            >
              Browse study material
            </Link>
          </div>
        ) : (
          <ul className="space-y-4">
            {owned.map((product) => (
              <li key={product.id}>
                <Link
                  href={`/read/${product.slug}`}
                  className="block rounded border border-rule bg-card p-6 transition-colors duration-150 hover:border-ink"
                >
                  <h2 className="font-display text-xl font-medium">{product.title}</h2>
                  {product.pageCount > 0 && (
                    <p className="mt-1 font-mono text-xs text-ink-soft">
                      {product.pageCount} pages
                    </p>
                  )}
                  <span className="mt-3 inline-block font-semibold text-ink">
                    Read now &rarr;
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  )
}
