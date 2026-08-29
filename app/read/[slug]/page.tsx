import { notFound, redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { readSession } from '@/lib/auth/session'
import { hasAccess, pageIndex, productBySlug } from '@/lib/entitlement'
import { Reader } from './reader'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { robots: { index: false, follow: false } }

export default async function ReadPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  const session = await readSession()
  if (!session) redirect(`/login?next=/read/${encodeURIComponent(slug)}`)

  const product = await productBySlug(slug)
  if (!product) notFound()

  // 404 rather than a "you don't own this" screen: the storefront is where
  // someone learns what exists, not a URL they guessed.
  if (!(await hasAccess(session.userId, product.id))) notFound()

  const pages = await pageIndex(product.id)

  return (
    <Reader
      slug={product.slug}
      title={product.title}
      pages={pages}
      viewerName={session.name}
    />
  )
}
