import type { ReactNode } from 'react'
import { SiteHeader } from './site-header'

/** Shared chrome for the four pages Razorpay requires before it will activate
 *  a live account. Deliberately plain — these are read, not browsed. */
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string
  updated: string
  children: ReactNode
}) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-2xl px-5 py-14">
        <h1 className="font-display text-2xl font-medium">{title}</h1>
        <p className="mt-2 font-mono text-xs text-ink-soft">Last updated: {updated}</p>
        <div className="mt-8 space-y-4 text-read leading-relaxed text-ink-soft [&_h2]:mt-8 [&_h2]:font-display [&_h2]:text-lg [&_h2]:font-medium [&_h2]:text-ink [&_strong]:text-ink">
          {children}
        </div>
      </main>
    </>
  )
}
