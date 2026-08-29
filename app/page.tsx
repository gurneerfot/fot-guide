import Link from 'next/link'
import { activeProducts } from '@/lib/entitlement'
import { SiteHeader } from './_components/site-header'
import { Storefront } from './_components/storefront'

export const dynamic = 'force-dynamic'

export default async function StorefrontPage() {
  const products = await activeProducts()

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-7xl px-5 py-14 sm:px-8 sm:py-20">
        <header className="mx-auto mb-14 max-w-2xl text-center sm:mb-20">
          <h1 className="font-display text-[2rem] leading-[1.15] font-bold tracking-tight text-ink sm:text-5xl">
            Study Material &amp; Coaching
          </h1>
          {/* The main site marks every section heading this way. */}
          <span aria-hidden className="mx-auto mt-6 block h-[3px] w-16 rounded-full bg-rouge" />
          <p className="mx-auto mt-7 max-w-xl text-read text-ink-soft">
            A guide you read online, mock tests marked by us, and one-to-one
            lessons. Add what you need and pay for it together — prices are in
            Canadian dollars with everything included.
          </p>
        </header>

        {products.length === 0 ? (
          <div className="mx-auto max-w-xl rounded-card border border-rule bg-card p-10 text-center shadow-card">
            <p className="text-read text-ink-soft">
              Nothing is on sale just yet. Please check back shortly.
            </p>
          </div>
        ) : (
          // Client from here down: the cart is selection state, and it must
          // survive re-renders without a round trip per tick of a checkbox.
          <Storefront
            products={products.map((product) => ({
              id: product.id,
              slug: product.slug,
              title: product.title,
              summary: product.summary,
              kind: product.kind,
              priceCents: product.priceCents,
              listPriceCents: product.listPriceCents,
              pageCount: product.pageCount,
            }))}
          />
        )}

        <footer className="mt-20 border-t border-rule pt-10 text-center">
          <p className="text-read text-ink-soft">
            Already bought?{' '}
            <Link
              href="/login"
              className="font-semibold text-ink underline decoration-rule underline-offset-4 transition-colors duration-200 hover:decoration-rouge"
            >
              Sign in with your access code
            </Link>
          </p>
          <p className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-ink-soft">
            <Link href="/terms" className="transition-colors duration-200 hover:text-rouge">
              Terms
            </Link>
            <Link href="/privacy" className="transition-colors duration-200 hover:text-rouge">
              Privacy
            </Link>
            <Link href="/refunds" className="transition-colors duration-200 hover:text-rouge">
              Refunds
            </Link>
            <Link href="/contact" className="transition-colors duration-200 hover:text-rouge">
              Contact
            </Link>
          </p>
        </footer>
      </main>
    </>
  )
}
